/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import betterAuth from "@convex-dev/better-auth/test";
import { expect, test } from "vitest";
import { components, internal } from "./_generated/api";
import { AuditType } from "./admin";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SESSION_TTL_MS = 86_400_000;

async function schoolUser() {
  const t = convexTest(schema, modules);
  betterAuth.register(t);
  const now = Date.now();
  const schoolId = await t.run((ctx) => ctx.db.insert("schools", { code: "S1", name: "School One", active: true }));
  const auth = await t.mutation(components.betterAuth.adapter.create, {
    input: { model: "user", data: { name: "school", email: "school@example.test", emailVerified: true, createdAt: now, updatedAt: now } },
  });
  const session = await t.mutation(components.betterAuth.adapter.create, {
    input: { model: "session", data: { userId: auth._id, token: crypto.randomUUID(), expiresAt: now + SESSION_TTL_MS, createdAt: now, updatedAt: now } },
  });
  await t.run((ctx) => ctx.db.insert("users", { authUserId: auth._id, displayName: "school", role: "school", schoolId }));
  return { t, schoolId, client: t.withIdentity({ subject: auth._id, sessionId: session._id }) };
}

test("prepare re-provisions a revoked simulator reader with a new secret", async () => {
  const { t, schoolId, client } = await schoolUser();
  const first = await client.mutation(internal.simulator.prepare, { schoolId });
  await t.run(async (ctx) => {
    const device = await ctx.db.query("devices").withIndex("by_deviceRef", (q) => q.eq("deviceRef", first.deviceRef)).unique();
    await ctx.db.patch(device!._id, { revokedAt: Date.now() });
  });

  const second = await client.mutation(internal.simulator.prepare, { schoolId });

  expect(second.signingKeyHex).not.toBe(first.signingKeyHex);
  const lookup = await t.query(internal.ingest.getDeviceSecretHash, { deviceRef: second.deviceRef });
  expect(lookup).toEqual({ secretHash: second.signingKeyHex });
  const audit = await t.run((ctx) =>
    ctx.db.query("events").withIndex("by_type_occurredAt", (q) => q.eq("type", AuditType.DeviceReprovisioned)).collect(),
  );
  expect(audit).toHaveLength(1);
});
