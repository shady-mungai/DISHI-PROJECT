import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { dispatchDelivery } from "../convex/deliveryWorkflow";
import { portionsFromKg } from "../convex/lib/portions";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

test("dispatch by containers and net kg counts portions from the serving size", async () => {
  const t = convexTest(schema, modules);
  const { schoolId, supplier } = await t.run(async (ctx) => {
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Pilot Primary", active: true });
    const supplierId = await ctx.db.insert("users", { authUserId: "auth-supplier", displayName: "Kitchen", role: "supplier" });
    await ctx.db.insert("menuItems", { dish: "githeri", active: true });
    return { schoolId, supplier: (await ctx.db.get(supplierId))! };
  });
  const send = (requestId: string, containers: number, netKg: number) =>
    t.run((ctx) => dispatchDelivery(ctx, supplier, { schoolId, containers, netKg, vehicle: "KDA 001", requestId, dish: "githeri" }));

  // Default 350 g: 70 kg -> 200 portions, stored with the containers.
  const first = await send("r-1", 4, 70);
  expect(first.portions).toBe(200);
  const row = await t.run((ctx) => ctx.db.get(first.deliveryId));
  expect([row?.portions, row?.containers, row?.netKg]).toEqual([200, 4, 70]);

  // Calibrated serving size; partial portions round down.
  await t.run((ctx) => ctx.db.insert("settings", { key: "portionGrams", value: 400, description: "" }));
  expect((await send("r-2", 4, 70.3)).portions).toBe(175);

  await expect(send("r-3", 0, 70)).rejects.toThrow("containers");
  await expect(send("r-4", 2, 0)).rejects.toThrow("kg");
  await expect(send("r-5", 1, 0.1)).rejects.toThrow("portions"); // under one portion
});

test("calculator and server share one rounding: whole grams, then whole portions", () => {
  expect(portionsFromKg(10, 350)).toBe(28);
  expect(portionsFromKg(4.55, 350)).toBe(13); // 4.55 * 1000 is 4549.999… in floating point
});
