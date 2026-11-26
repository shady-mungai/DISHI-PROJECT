import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { dispatchDelivery } from "../convex/deliveryWorkflow";
import { rotationOrder } from "../convex/lib/dishInsights";
import { serveByOverride } from "../convex/overrides";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const NOW = Date.parse("2026-09-21T09:30:00.000Z");
const DEVICE_REF = "READER-01";

type Harness = ReturnType<typeof convexTest>;
type World = { schoolId: Id<"schools">; studentIds: Id<"students">[]; staff: Doc<"users">; supplier: Doc<"users"> };

afterEach(() => {
  vi.useRealTimers();
});

async function seedWorld(t: Harness): Promise<World> {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const world = await t.run(async (ctx) => {
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Pilot Primary", active: true });
    await ctx.db.insert("menuItems", { dish: "githeri", active: true });
    await ctx.db.insert("menuItems", { dish: "pilau", active: false });
    const studentIds: Id<"students">[] = [];
    for (const index of [0, 1]) {
      const studentId = await ctx.db.insert("students", { schoolId, studentRef: `STU-${index}`, fullName: `Child ${index}`, className: "4A", status: "active" });
      await ctx.db.insert("tags", { tagUid: `tag-${index}`, studentId, status: "active", issuedAt: NOW });
      studentIds.push(studentId);
    }
    const staffId = await ctx.db.insert("users", { authUserId: "auth-staff", displayName: "Head", role: "school", schoolId });
    const supplierId = await ctx.db.insert("users", { authUserId: "auth-supplier", displayName: "Kitchen", role: "supplier" });
    return { schoolId, studentIds, staff: (await ctx.db.get(staffId))!, supplier: (await ctx.db.get(supplierId))! };
  });
  await t.mutation(internal.devices.registerDevice, { deviceRef: DEVICE_REF, schoolId: world.schoolId, secret: "demo-device-secret", firmwareVersion: "1.0.0" });
  return world;
}

function dispatch(t: Harness, world: World, dish: string) {
  return t.run(async (ctx) => await dispatchDelivery(ctx, world.supplier, { schoolId: world.schoolId, portions: 2, vehicle: "KDA 001", docketRef: "D-1", requestId: `r-${dish}`, dish }));
}

async function receive(t: Harness, deliveryId: Id<"deliveries">) {
  await t.run(async (ctx) => await ctx.db.patch(deliveryId, { status: "confirmed", portionsReceived: 2, receiptRecordedAt: NOW }));
}

function tap(t: Harness, eventId: string, tagUid: string) {
  return t.mutation(internal.ingest.recordBatch, { deviceRef: DEVICE_REF, events: [{ eventId, tagUid, occurredAt: NOW }] });
}

describe("no supply, no service", () => {
  test("taps and overrides are refused until a delivery is received, then served", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);

    expect(await tap(t, "tap-early", "tag-0")).toEqual([{ eventId: "tap-early", status: "rejected", reason: "no_supply" }]);
    await expect(t.run((ctx) => serveByOverride(ctx, { actor: world.staff, schoolId: world.schoolId, studentId: world.studentIds[1], reasonCode: "lost_tag" }))).rejects.toThrow("no_supply");

    const { deliveryId } = await dispatch(t, world, "githeri");
    expect((await tap(t, "tap-in-transit", "tag-0"))[0].reason).toBe("no_supply");

    await receive(t, deliveryId);
    expect((await tap(t, "tap-served", "tag-0"))[0].status).toBe("accepted");
    expect((await t.run((ctx) => serveByOverride(ctx, { actor: world.staff, schoolId: world.schoolId, studentId: world.studentIds[1], reasonCode: "lost_tag" }))).status).toBe("served");
  });
});

describe("menu", () => {
  test("a dispatch must name an active menu dish", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await expect(dispatch(t, world, "chips")).rejects.toThrow("active menu");
    await expect(dispatch(t, world, "pilau")).rejects.toThrow("active menu");
    const { deliveryId } = await dispatch(t, world, "  GITHERI ");
    expect((await t.run((ctx) => ctx.db.get(deliveryId)))?.dish).toBe("githeri");
  });

  test("rotation puts never-served dishes first, then the longest since served", () => {
    const order = rotationOrder(
      ["githeri", "pilau", "rice and ndengu", "chapati"],
      [
        { dish: "githeri", serviceDate: "2026-09-14" },
        { dish: "githeri", serviceDate: "2026-09-18" },
        { dish: "pilau", serviceDate: "2026-09-15" },
        { dish: "rice and ndengu", serviceDate: "2026-09-18" },
        { dish: "not on menu", serviceDate: "2026-09-01" },
      ],
    );
    expect(order.map((entry) => entry.dish)).toEqual(["chapati", "pilau", "rice and ndengu", "githeri"]);
    expect(order[3]).toEqual({ dish: "githeri", lastServed: "2026-09-18", timesServed: 2 });
  });
});
