/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import betterAuth from "@convex-dev/better-auth/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ARRIVAL_MS, CODE_COOLDOWN_MS } from "./lib/deliveryWorkflow";
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
      (await w.t.run((ctx) => ctx.db.query("deliveryInbox").collect())).map(
        (r) => r.recipientKey,
      ),
    ).toEqual([`school:${w.schoolId}`]);
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
  test("matching photo receipt confirms immediately, idempotently, and queues admin review", async () => {
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
      reviewRequired: true,
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
  test("code records receipt, invalidates replaced codes, and confirms without review", async () => {
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
      status: "confirmed",
      receiptMethod: "code",
      missingEvidence: false,
      reviewRequired: false,
    });
    expect(
      await w.t.run((ctx) => paymentLines(ctx, { from: DAY, to: DAY })),
    ).toHaveLength(1);
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

describe("operational SMS", () => {
  test("confirmation, dispute and admin resolution notify the school and supplier", async () => {
    const w = await world();
    const inboxFor = async (deliveryId: Id<"deliveries">) =>
      (
        await w.t.run((ctx) => ctx.db.query("deliveryInbox").collect())
      ).filter((r) => r.deliveryId === deliveryId);
    const ok = await receipt(w);
    const confirmed = (await inboxFor(ok.deliveryId)).filter((r) =>
      r.dedupeKey.includes(":receipt.confirmed:"),
    );
    expect(confirmed.map((r) => r.recipientKey).sort()).toEqual(
      [`school:${w.schoolId}`, `supplier:${w.supplier.id}`].sort(),
    );
    expect(confirmed[0].body).toContain("confirmed: 40 of 40");
    const bad = await receipt(w, 38, "Short");
    const disputed = (await inboxFor(bad.deliveryId)).filter((r) =>
      r.dedupeKey.includes(":receipt.disputed:"),
    );
    expect(disputed.map((r) => r.recipientKey)).toContain("admin");
    await w.admin.client.mutation(api.deliveryWorkflow.resolve, {
      deliveryId: bad.deliveryId,
      decision: "confirm",
      reason: "Reconciled",
      requestId: crypto.randomUUID(),
    });
    expect(
      (await inboxFor(bad.deliveryId)).filter((r) =>
        r.dedupeKey.includes(":admin.confirmed:"),
      ),
    ).toHaveLength(2);
  });
  test("Celcom simulation: each actor receives exactly the expected delivery SMS", async () => {
    const w = await world();
    await w.t.run((ctx) =>
      ctx.db.insert("settings", {
        key: "smsChannel",
        value: "celcom",
        description: "test",
      }),
    );
    vi.stubEnv("CELCOM_URL", "https://celcom.test/send");
    vi.stubEnv("CELCOM_API_KEY", "k");
    vi.stubEnv("CELCOM_PARTNER_ID", "p");
    vi.stubEnv("CELCOM_SHORTCODE", "DISHI");
    const sent: { mobile: string; message: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({ responses: [{ "response-code": 200, messageid: sent.length }] }),
          { status: 200 },
        );
      }),
    );
    const numbers = { school: "+254711000001", supplier: "+254711000002", admin: "+254711000003" };
    for (const [audience, msisdn] of Object.entries(numbers))
      await w.admin.client.mutation(api.deliveryNotifications.saveContact, {
        ...(audience === "school" ? { schoolId: w.schoolId } : {}),
        ...(audience === "supplier" ? { supplierId: w.supplier.id } : {}),
        name: audience,
        msisdn,
        active: true,
      });
    const flush = async () => {
      for (const row of await w.t.run((ctx) =>
        ctx.db.query("deliverySms").collect(),
      ))
        if (row.status === "queued")
          await w.t.action(internal.deliveryNotifications.send, { smsId: row._id });
    };
    const inbox = (m: string) =>
      sent.filter((x) => x.mobile === m.slice(1)).map((x) => x.message);
    const step = async (label: string, run: () => Promise<unknown>) => {
      const before = sent.length;
      await run();
      await flush();
      return { label, to: sent.slice(before).map((x) => x.mobile).sort() };
    };
    const digits = (k: keyof typeof numbers) => numbers[k].slice(1);
    let goodId: Id<"deliveries">;
    let badId: Id<"deliveries">;
    const steps = [
      await step("dispatch", async () => (goodId = (await dispatch(w)).deliveryId)),
      await step("photo receipt confirmed", async () => {
        const evidenceId = await photo(w, goodId);
        await w.school.client.mutation(api.deliveryWorkflow.submitReceipt, {
          deliveryId: goodId, evidenceId, portionsReceived: 40, problem: "", requestId: crypto.randomUUID(),
        });
      }),
      await step("dispatch #2", async () => (badId = (await dispatch(w)).deliveryId)),
      await step("code receipt disputed", async () => {
        const issued = await code(w, badId, 35);
        await redeem(w, badId, issued.code!);
      }),
      await step("admin confirms", () =>
        w.admin.client.mutation(api.deliveryWorkflow.resolve, {
          deliveryId: badId, decision: "confirm", reason: "Reconciled with school", requestId: crypto.randomUUID(),
        }),
      ),
    ];
    console.log(JSON.stringify(steps));
    expect(steps.map((x) => x.to)).toEqual([
      [digits("school")],
      [digits("school"), digits("supplier")].sort(),
      [digits("school")],
      [digits("school"), digits("supplier"), digits("admin")].sort(),
      [digits("school"), digits("supplier")].sort(),
    ]);
    expect(inbox(numbers.supplier).some((m) => m.includes("incoming"))).toBe(false);
    expect(inbox(numbers.admin)[0]).toContain("disputed: 35 of 40");
    expect(
      new Set(
        (await w.t.run((ctx) => ctx.db.query("deliverySms").collect())).map(
          (r) => r.status,
        ),
      ),
    ).toEqual(new Set(["sent"]));
  });
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
    const sms = (
      await w.t.run((ctx) => ctx.db.query("deliverySms").collect())
    ).filter((s) => s.msisdn);
    expect(sms).toHaveLength(1);
    await w.t.action(internal.deliveryNotifications.send, {
      smsId: sms[0]._id,
    });
    expect(
      await w.admin.client.query(api.deliveryNotifications.failures, {}),
    ).toContainEqual(
      expect.objectContaining({
        failureReason: "SMS console mode: no SMS sent",
      }),
    );
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
