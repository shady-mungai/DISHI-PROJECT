/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import betterAuth from "@convex-dev/better-auth/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  ARRIVAL_MS,
  CODE_COOLDOWN_MS,
  PHOTO_MODEL,
} from "./lib/deliveryWorkflow";
import { paymentLines, reconcileDay } from "./deliveries";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.parse("2026-11-04T08:00:00Z");
const DAY = "2026-11-04";
type Harness = ReturnType<typeof convexTest>;
async function user(
  t: Harness,
  role: "school" | "supplier" | "admin" | "county",
  schoolId?: Id<"schools">,
) {
  const auth = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "user",
      data: {
        name: role,
        email: `${crypto.randomUUID()}@example.test`,
        emailVerified: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
  });
  const session = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "session",
      data: {
        userId: auth._id,
        token: crypto.randomUUID(),
        expiresAt: NOW + 86_400_000,
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
  });
  const id = await t.run((ctx) =>
    ctx.db.insert("users", {
      authUserId: auth._id,
      displayName: role,
      role,
      schoolId,
    }),
  );
  return {
    id,
    client: t.withIdentity({ subject: auth._id, sessionId: session._id }),
  };
}
async function world() {
  const t = convexTest(schema, modules);
  betterAuth.register(t);
  rateLimiter.register(t);
  const schoolId = await t.run((ctx) =>
    ctx.db.insert("schools", { code: "S1", name: "School One", active: true }),
  );
  const otherSchool = await t.run((ctx) =>
    ctx.db.insert("schools", { code: "S2", name: "School Two", active: true }),
  );
  const school = await user(t, "school", schoolId);
  const other = await user(t, "school", otherSchool);
  const supplier = await user(t, "supplier");
  const admin = await user(t, "admin");
  return { t, schoolId, otherSchool, school, other, supplier, admin };
}
type World = Awaited<ReturnType<typeof world>>;
async function dispatch(w: World, requestId = crypto.randomUUID()) {
  return w.supplier.client.mutation(api.deliveryWorkflow.dispatch, {
    schoolId: w.schoolId,
    portions: 40,
    vehicle: "KAA 100A",
    docketRef: "DK-1",
    requestId,
  });
}
const png = () =>
  new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
    0, 0, 1,
  ]);
async function photo(w: World, deliveryId: Id<"deliveries">) {
  const response = await w.school.client.fetch("/delivery-photo", {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-Delivery-Id": deliveryId,
      "X-Request-Id": crypto.randomUUID(),
    },
    body: png(),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { evidenceId: Id<"deliveryEvidence"> })
    .evidenceId;
}
async function receipt(w: World, portionsReceived = 40, problem = "") {
  const { deliveryId } = await dispatch(w);
  const evidenceId = await photo(w, deliveryId);
  const args = {
    deliveryId,
    evidenceId,
    portionsReceived,
    problem,
    requestId: crypto.randomUUID(),
  };
  await w.school.client.mutation(api.deliveryWorkflow.submitReceipt, args);
  return { deliveryId, evidenceId, args };
}
async function code(
  w: World,
  deliveryId: Id<"deliveries">,
  portionsReceived = 40,
) {
  return w.school.client.mutation(api.deliveryWorkflow.requestCode, {
    deliveryId,
    portionsReceived,
    problem: "",
    requestId: crypto.randomUUID(),
  });
}
async function redeem(
  w: World,
  deliveryId: Id<"deliveries">,
  value: string,
  requestId = crypto.randomUUID(),
) {
  return w.supplier.client.mutation(api.deliveryWorkflow.redeemCode, {
    deliveryId,
    code: value,
    requestId,
  });
}
beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://example.test");
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("school-confirmed delivery workflow", () => {
  test("dispatch uses server time, deduplicates retries and notifies once", async () => {
    const w = await world();
    const key = crypto.randomUUID();
    const first = await dispatch(w, key);
    expect(await dispatch(w, key)).toEqual(first);
    expect(first.expectedArrivalAt).toBe(NOW + ARRIVAL_MS);
    const rows = await w.t.run((ctx) => ctx.db.query("deliveries").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workflowVersion: 2,
      dispatchedAt: NOW,
      confirmCodeHash: "",
      serviceDate: DAY,
    });
    expect(
      await w.t.run((ctx) => ctx.db.query("deliveryInbox").collect()),
    ).toHaveLength(1);
    expect(
      await w.admin.client.query(api.deliveryNotifications.failures, {}),
    ).toHaveLength(1);
    await expect(
      w.supplier.client.mutation(api.deliveryWorkflow.dispatch, {
        schoolId: w.schoolId,
        portions: 41,
        vehicle: "KAA 100A",
        docketRef: "DK-1",
        requestId: key,
      }),
    ).rejects.toThrow("different details");
  });
  test("matching photo receipt confirms immediately, idempotently, while assessment is pending", async () => {
    const w = await world();
    const r = await receipt(w);
    expect(
      await w.school.client.mutation(
        api.deliveryWorkflow.submitReceipt,
        r.args,
      ),
    ).toEqual({ status: "confirmed" });
    expect(await w.t.run((ctx) => ctx.db.get(r.deliveryId))).toMatchObject({
      status: "confirmed",
      photoReview: "pending",
      receiptMethod: "photo",
      portionsReceived: 40,
    });
    expect(
      await w.t.run((ctx) => paymentLines(ctx, { from: DAY, to: DAY })),
    ).toHaveLength(1);
    expect(
      (
        await w.admin.client.query(api.deliveryDashboard.detail, {
          deliveryId: r.deliveryId,
        })
      ).timeline.filter((e) => e.type === "receipt.confirmed"),
    ).toHaveLength(1);
    const totals = await w.t.run((ctx) =>
      reconcileDay(ctx, { schoolId: w.schoolId, serviceDate: DAY }),
    );
    expect(totals).toMatchObject({
      dispatched: 40,
      confirmed: 40,
      received: 40,
      consumed: 0,
    });
  });
  test.each([
    [38, ""],
    [40, "Damaged container"],
  ])(
    "quantity %s / problem %s enters resolution without payment",
    async (portions, problem) => {
      const w = await world();
      const r = await receipt(w, portions, problem);
      expect(await w.t.run((ctx) => ctx.db.get(r.deliveryId))).toMatchObject({
        status: "disputed",
        reviewRequired: true,
      });
      expect(
        await w.t.run((ctx) => paymentLines(ctx, { from: DAY, to: DAY })),
      ).toHaveLength(0);
      await expect(
        w.admin.client.mutation(api.deliveryWorkflow.resolve, {
          deliveryId: r.deliveryId,
          decision: "confirm",
          reason: "  ",
          requestId: crypto.randomUUID(),
        }),
      ).rejects.toThrow("required");
      await w.admin.client.mutation(api.deliveryWorkflow.resolve, {
        deliveryId: r.deliveryId,
        decision: "confirm",
        reason: "School and supplier reconciled the quantities",
        requestId: crypto.randomUUID(),
      });
      expect(
        await w.t.run((ctx) => paymentLines(ctx, { from: DAY, to: DAY })),
      ).toMatchObject([{ portionsConfirmed: portions }]);
      expect(
        await w.t.run((ctx) =>
          ctx.db
            .query("events")
            .withIndex("by_type_occurredAt", (q) =>
              q.eq("type", "admin.delivery_resolved"),
            )
            .collect(),
        ),
      ).toHaveLength(1);
    },
  );
  test("fallback records receipt, invalidates replaced codes, and retains missing evidence after redemption", async () => {
    const w = await world();
    const { deliveryId } = await dispatch(w);
    const first = await code(w, deliveryId);
    const second = await code(w, deliveryId);
    expect(await redeem(w, deliveryId, first.code!)).toMatchObject({
      status: expect.stringContaining("Incorrect"),
    });
    expect(await redeem(w, deliveryId, second.code!)).toEqual({
      status: "confirmed",
    });
    expect(await w.t.run((ctx) => ctx.db.get(deliveryId))).toMatchObject({
      receiptMethod: "code",
      missingEvidence: true,
      reviewRequired: true,
    });
    const stored = await w.t.run((ctx) =>
      ctx.db.query("receiptCodes").unique(),
    );
    expect(stored?.hash).toBe("");
    expect(stored?.usedAt).toBe(NOW);
    await expect(redeem(w, deliveryId, second.code!)).rejects.toThrow(
      "already submitted",
    );
  });
  test("five wrong attempts commit a cooldown; retries do not consume attempts and replacement cannot bypass it", async () => {
    const w = await world();
    const { deliveryId } = await dispatch(w);
    const issued = await code(w, deliveryId);
    const wrong = issued.code === "000000" ? "111111" : "000000";
    const key = crypto.randomUUID();
    await redeem(w, deliveryId, wrong, key);
    await redeem(w, deliveryId, wrong, key);
    expect(
      (await w.t.run((ctx) => ctx.db.query("receiptCodes").unique()))?.failures,
    ).toBe(1);
    for (let i = 0; i < 4; i++) await redeem(w, deliveryId, wrong);
    const replacement = await code(w, deliveryId);
    expect((await redeem(w, deliveryId, replacement.code!)).status).toContain(
      "cooldown",
    );
    expect((await w.t.run((ctx) => ctx.db.get(deliveryId)))?.status).toBe(
      "declared",
    );
    vi.setSystemTime(NOW + CODE_COOLDOWN_MS + 1);
    expect(await redeem(w, deliveryId, replacement.code!)).toEqual({
      status: "confirmed",
    });
  });
  test("expired codes cannot confirm, while a new code and late photo receipt remain possible", async () => {
    const w = await world();
    const { deliveryId } = await dispatch(w);
    const issued = await code(w, deliveryId);
    vi.setSystemTime(NOW + ARRIVAL_MS);
    expect((await redeem(w, deliveryId, issued.code!)).status).toContain(
      "expired",
    );
    expect(
      await w.t.mutation(internal.deliveryWorkflow.markOverdue, { deliveryId }),
    ).toBe(false);
    const evidenceId = await photo(w, deliveryId);
    expect(
      await w.school.client.mutation(api.deliveryWorkflow.submitReceipt, {
        deliveryId,
        evidenceId,
        portionsReceived: 40,
        problem: "",
        requestId: crypto.randomUUID(),
      }),
    ).toEqual({ status: "confirmed" });
  });
  test("overdue escalation fires once to school, supplier and admin; late receipts still confirm", async () => {
    const w = await world();
    const { deliveryId } = await dispatch(w);
    expect(
      await w.t.mutation(internal.deliveryWorkflow.markOverdue, { deliveryId }),
    ).toBe(false);
    vi.setSystemTime(NOW + ARRIVAL_MS);
    expect(
      await w.t.mutation(internal.deliveryWorkflow.markOverdue, { deliveryId }),
    ).toBe(true);
    expect(
      await w.t.mutation(internal.deliveryWorkflow.markOverdue, { deliveryId }),
    ).toBe(false);
    const inbox = await w.t.run((ctx) =>
      ctx.db.query("deliveryInbox").collect(),
    );
    expect(inbox).toHaveLength(4);
    const issued = await code(w, deliveryId);
    expect(await redeem(w, deliveryId, issued.code!)).toEqual({
      status: "confirmed",
    });
  });
  test("concurrent confirmations cannot overwrite school quantities", async () => {
    const w = await world();
    const { deliveryId } = await dispatch(w);
    const evidenceId = await photo(w, deliveryId);
    const args = {
      deliveryId,
      evidenceId,
      portionsReceived: 40,
      problem: "",
      requestId: crypto.randomUUID(),
    };
    const settled = await Promise.allSettled([
      w.school.client.mutation(api.deliveryWorkflow.submitReceipt, args),
      w.school.client.mutation(api.deliveryWorkflow.submitReceipt, {
        ...args,
        portionsReceived: 39,
        requestId: crypto.randomUUID(),
      }),
    ]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await w.admin.client.query(api.deliveryDashboard.detail, { deliveryId })
      ).timeline.filter((e) => e.type.startsWith("receipt.")),
    ).toHaveLength(1);
  });
  test("school boundaries, supplier ownership, admin reasons and private photo access are enforced", async () => {
    const w = await world();
    const r = await receipt(w);
    const stranger = await user(w.t, "supplier");
    await expect(
      w.other.client.query(api.deliveryDashboard.detail, {
        deliveryId: r.deliveryId,
      }),
    ).rejects.toThrow("scope");
    await expect(
      w.other.client.mutation(api.deliveryWorkflow.requestCode, {
        deliveryId: r.deliveryId,
        portionsReceived: 40,
        problem: "",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("scope");
    await expect(
      stranger.client.mutation(api.deliveryWorkflow.redeemCode, {
        deliveryId: r.deliveryId,
        code: "123456",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("scope");
    await expect(
      w.school.client.mutation(api.deliveryWorkflow.resolve, {
        deliveryId: r.deliveryId,
        decision: "confirm",
        reason: "fake",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("scope");
    expect(
      (await w.other.client.fetch(`/delivery-photo?id=${r.evidenceId}`)).status,
    ).toBe(403);
    expect((await w.t.fetch(`/delivery-photo?id=${r.evidenceId}`)).status).toBe(
      401,
    );
    expect(
      (await w.school.client.fetch(`/delivery-photo?id=${r.evidenceId}`))
        .status,
    ).toBe(200);
    const detail = await w.school.client.query(api.deliveryDashboard.detail, {
      deliveryId: r.deliveryId,
    });
    expect(JSON.stringify(detail)).not.toContain("storageId");
    expect(JSON.stringify(detail)).not.toContain("confirmCodeHash");
  });
  test("upload rejects unrelated owners, wrong types and over-10 MB before storage", async () => {
    const w = await world();
    const { deliveryId } = await dispatch(w);
    for (const [contentType, body, status] of [
      ["image/png", new Uint8Array([1, 2, 3]), 415],
      ["image/png", new Uint8Array(10 * 1024 * 1024 + 1), 413],
    ] as const) {
      const result = await w.school.client.fetch("/delivery-photo", {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "X-Delivery-Id": deliveryId,
          "X-Request-Id": crypto.randomUUID(),
        },
        body,
      });
      expect(result.status).toBe(status);
    }
    const r = await w.other.client.fetch("/delivery-photo", {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Delivery-Id": deliveryId,
        "X-Request-Id": crypto.randomUUID(),
      },
      body: png(),
    });
    expect(r.status).toBe(400);
    expect(
      await w.t.run((ctx) => ctx.db.query("deliveryEvidence").collect()),
    ).toHaveLength(0);
  });
  test("photo evidence is bound to its delivery", async () => {
    const w = await world();
    const first = await dispatch(w);
    const second = await dispatch(w);
    const evidenceId = await photo(w, first.deliveryId);
    await expect(
      w.school.client.mutation(api.deliveryWorkflow.submitReceipt, {
        deliveryId: second.deliveryId,
        evidenceId,
        portionsReceived: 40,
        problem: "",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("Upload a photo");
  });
  test("forecasts distinguish zero from unavailable and non-school days", async () => {
    const w = await world();
    const serviceDate = "2026-11-05";
    await w.t.run((ctx) =>
      ctx.db.insert("forecasts", {
        schoolId: w.schoolId,
        serviceDate,
        portions: 0,
        confidence: "low",
        computedAt: NOW,
      }),
    );
    const rows = await w.supplier.client.query(
      api.deliveryDashboard.forecasts,
      { serviceDate },
    );
    expect(rows.find((r) => r.schoolId === w.schoolId)).toMatchObject({
      state: "available",
      portions: 0,
      computedAt: NOW,
    });
    expect(rows.find((r) => r.schoolId === w.otherSchool)).toMatchObject({
      state: "unavailable",
      portions: null,
    });
    await w.t.run((ctx) =>
      ctx.db.insert("academicCalendar", {
        serviceDate: "2026-11-08",
        isSchoolDay: false,
        dayType: "holiday",
      }),
    );
    expect(
      (
        await w.supplier.client.query(api.deliveryDashboard.forecasts, {
          serviceDate: "2026-11-08",
        })
      )[0].state,
    ).toBe("not_school_day");
  });
});

describe("advisory Groq and operational SMS", () => {
  test.each([true, false])(
    "Groq clear=%s does not change confirmation or payment eligibility",
    async (clear) => {
      vi.stubEnv("GROQ_API_KEY", "test-key");
      const w = await world();
      const r = await receipt(w);
      const fetchMock = vi.fn<typeof fetch>(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  foodVisible: clear,
                  clarity: "clear",
                  unrelatedContent: !clear,
                  description: "Visible food containers",
                }),
              },
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      await w.t.action(internal.deliveryAssessment.assess, {
        deliveryId: r.deliveryId,
        generation: 1,
        attempt: 0,
      });
      expect(await w.t.run((ctx) => ctx.db.get(r.deliveryId))).toMatchObject({
        status: "confirmed",
        photoReview: clear ? "clear" : "flagged",
        photoModel: PHOTO_MODEL,
      });
      expect(
        await w.t.run((ctx) => paymentLines(ctx, { from: DAY, to: DAY })),
      ).toHaveLength(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).model).toBe(
        PHOTO_MODEL,
      );
    },
  );
  test.each(["malformed", "unavailable"])(
    "%s Groq responses retry three times then allow audited retry",
    async (failure) => {
      vi.stubEnv("GROQ_API_KEY", "test-key");
      const w = await world();
      const r = await receipt(w);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          failure === "unavailable"
            ? new Response("unavailable", { status: 503 })
            : Response.json({ choices: [{ message: { content: "{}" } }] }),
        ),
      );
      for (let attempt = 0; attempt < 4; attempt++)
        await w.t.action(internal.deliveryAssessment.assess, {
          deliveryId: r.deliveryId,
          generation: 1,
          attempt,
        });
      expect(await w.t.run((ctx) => ctx.db.get(r.deliveryId))).toMatchObject({
        status: "confirmed",
        photoReview: "failed",
        photoAttempts: 4,
        reviewRequired: true,
      });
      await w.admin.client.mutation(api.deliveryAssessment.retry, {
        deliveryId: r.deliveryId,
        reason: "Provider recovered",
      });
      expect(await w.t.run((ctx) => ctx.db.get(r.deliveryId))).toMatchObject({
        photoReview: "pending",
        photoGeneration: 2,
        photoAttempts: 0,
      });
      await w.t.mutation(internal.deliveryAssessment.finish, {
        deliveryId: r.deliveryId,
        generation: 1,
        attempt: 4,
        transient: false,
        error: "stale",
      });
      expect(
        (await w.t.run((ctx) => ctx.db.get(r.deliveryId)))?.photoReview,
      ).toBe("pending");
    },
  );
  test("SMS contacts deduplicate and failed sends remain visible without changing receipt", async () => {
    const w = await world();
    const contact = {
      schoolId: w.schoolId,
      name: "School contact",
      msisdn: "+254712345678",
      active: true,
    };
    await w.admin.client.mutation(
      api.deliveryNotifications.saveContact,
      contact,
    );
    await w.admin.client.mutation(
      api.deliveryNotifications.saveContact,
      contact,
    );
    const key = crypto.randomUUID();
    const { deliveryId } = await dispatch(w, key);
    await dispatch(w, key);
    const sms = await w.t.run((ctx) => ctx.db.query("deliverySms").collect());
    expect(sms).toHaveLength(1);
    await w.t.action(internal.deliveryNotifications.send, {
      smsId: sms[0]._id,
    });
    expect(
      await w.admin.client.query(api.deliveryNotifications.failures, {}),
    ).toMatchObject([{ failureReason: "SMS console mode: no SMS sent" }]);
    expect((await w.t.run((ctx) => ctx.db.get(deliveryId)))?.status).toBe(
      "declared",
    );
    expect(
      await w.t.mutation(internal.deliveryNotifications.claim, {
        smsId: sms[0]._id,
      }),
    ).toBeNull();
  });
});
