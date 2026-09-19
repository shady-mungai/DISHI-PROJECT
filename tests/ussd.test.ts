import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { isGsm7 } from "../convex/lib/gsm7";
import { NOTIFICATION_TYPES, renderUssd, USSD_SCREEN_LIMIT, USSD_SHORT_CODE } from "../convex/lib/ussd";
import type { UssdGuardian } from "../convex/lib/ussd";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const TODAY = "2026-09-18";
const NOW = Date.parse(`${TODAY}T10:00:00.000Z`);
const TOKEN = "test-ussd-token";
let currentSession = "sess-0";
const GUARDIAN_MSISDN = "+254712345678";
const GATEWAY_MSISDN = "254712345678";
const NEW_MSISDN = "0722000111";
const PRIOR_DAYS: { serviceDate: string; status: "fulfilled" | "missed" }[] = [
  { serviceDate: "2026-09-10", status: "fulfilled" },
  { serviceDate: "2026-09-11", status: "missed" },
  { serviceDate: "2026-09-14", status: "fulfilled" },
  { serviceDate: "2026-09-15", status: "fulfilled" },
  { serviceDate: "2026-09-16", status: "fulfilled" },
  { serviceDate: "2026-09-17", status: "missed" },
];

type Harness = ReturnType<typeof convexTest>;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function seedWorld(t: Harness, children = 1): Promise<Id<"guardians">> {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("USSD_TOKEN", TOKEN);
  return await t.run(async (ctx) => {
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Test", active: true });
    const guardianId = await ctx.db.insert("guardians", {
      msisdn: GUARDIAN_MSISDN,
      displayName: "Mama Amina",
      language: "en",
      optedOutTypes: [],
    });
    const names = ["Amina", "Brian"].slice(0, children);
    for (const [index, fullName] of names.entries()) {
      const studentId = await ctx.db.insert("students", {
        schoolId,
        studentRef: `STU-${index}`,
        fullName,
        className: "4A",
        status: "active",
      });
      await ctx.db.insert("guardianLinks", { guardianId, studentId, relationship: "mother", active: true });
      await ctx.db.insert("wallets", { studentId, balanceKes: 120 });
      for (const day of [...PRIOR_DAYS, { serviceDate: TODAY, status: "pending" as const }]) {
        await ctx.db.insert("expectations", {
          schoolId,
          studentId,
          serviceDate: day.serviceDate,
          windowStart: NOW,
          windowEnd: NOW,
          cutoffAt: NOW,
          status: day.status,
        });
      }
    }
    return guardianId;
  });
}

async function dial(t: Harness, input: string, msisdn = GATEWAY_MSISDN, token = TOKEN): Promise<{ status: number; text: string }> {
  const params = new URLSearchParams({ SESSIONID: currentSession, MSISDN: msisdn, USSDCODE: USSD_SHORT_CODE, INPUT: input });
  const res = await t.fetch(`/ussd/${token}?${params}`, { method: "GET" });
  return { status: res.status, text: await res.text() };
}

async function walk(t: Harness, inputs: string[]): Promise<string> {
  currentSession = `sess-${Date.now()}-${Math.random()}`;
  return (await dial(t, inputs.join("*"))).text;
}

describe("GET /ussd/<token>", () => {
  test("rejects a wrong token", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    expect((await dial(t, "", GATEWAY_MSISDN, "nope")).status).toBe(401);
  });

  test("unknown MSISDN ends the session", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    const { text } = await dial(t, "", "254700000000");
    expect(text).toMatch(/^END .*not registered/);
  });

  test("first dial opens the main menu whether INPUT is empty or the dialed code, matching the guardian by bare 254 spelling", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    for (const input of ["", USSD_SHORT_CODE, "265*39#", "*265*39"]) {
      expect((await dial(t, input)).text, `INPUT=${input}`).toMatch(/^CON Dishi\n1\. Status today/);
    }
  });

  test("the dialed code as a path prefix is ignored when routing", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    expect((await dial(t, `${USSD_SHORT_CODE}*2`)).text).toBe("CON Amina balance: KES 120\n0. Back");
    expect((await dial(t, `${USSD_SHORT_CODE}2`)).text).toBe("CON Amina balance: KES 120\n0. Back");
    expect((await dial(t, "*265*39*2#")).text).toBe("CON Amina balance: KES 120\n0. Back");
  });

  test("one session walks main menu -> notifications -> toggle as CON, CON, END", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    currentSession = "sess-walk";
    const prefixes: string[] = [];
    for (const input of ["", "4", "4*1"]) {
      prefixes.push((await dial(t, input)).text.slice(0, 3));
    }
    expect(prefixes).toEqual(["CON", "CON", "END"]);
  });

  test("an answer screen stays open and 0 returns to the main menu", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    expect(await walk(t, ["2", "0"])).toMatch(/^CON Dishi/);
  });

  test("P-07: status, balance and last five meal days each resolve in one session", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    expect(await walk(t, ["1"])).toBe("CON Amina has not eaten yet today.\n0. Back");
    expect(await walk(t, ["2"])).toBe("CON Amina balance: KES 120\n0. Back");
    const history = await walk(t, ["3"]);
    expect(history).toBe("CON Amina:\n17/09 missed\n16/09 ate\n15/09 ate\n14/09 ate\n11/09 missed\n0. Back");
  });

  test("a guardian with two children gets a picker, then the answer", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t, 2);
    expect(await walk(t, ["2"])).toBe("CON Which child?\n1. Amina\n2. Brian");
    expect(await walk(t, ["2", "2"])).toBe("CON Brian balance: KES 120\n0. Back");
  });

  test("P-08: toggling an alert flips optedOutTypes and writes an audited event", async () => {
    const t = convexTest(schema, modules);
    const guardianId = await seedWorld(t);
    expect(await walk(t, ["4"])).toMatch(/^CON Alerts[\s\S]*\n1\. Meal eaten ON\n/);
    expect(await walk(t, ["4", "1"])).toBe("END Meal eaten alerts now OFF");
    const { guardian, event } = await t.run(async (ctx) => ({
      guardian: await ctx.db.get(guardianId),
      event: await ctx.db
        .query("events")
        .withIndex("by_correlationId", (q) => q.eq("correlationId", currentSession))
        .unique(),
    }));
    expect(guardian?.optedOutTypes).toEqual(["meal.tapped"]);
    expect(event?.type).toBe("guardian.preferences_updated");
    expect(event?.payload.opted_out).toBe(true);
  });

  test("0 steps back one level instead of being treated as a choice", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    expect(await walk(t, ["4", "0"])).toMatch(/^CON Dishi/);
  });

  test("P-09: number change asks for confirmation, updates, and audits old and new", async () => {
    const t = convexTest(schema, modules);
    const guardianId = await seedWorld(t);
    expect(await walk(t, ["5"])).toBe("CON Enter new number (07XXXXXXXX)");
    expect(await walk(t, ["5", "12"])).toMatch(/^END .*not a valid/);
    expect(await walk(t, ["5", NEW_MSISDN])).toBe("CON Send alerts to +254722000111?\n1. Yes\n2. No");
    expect(await walk(t, ["5", NEW_MSISDN, "1"])).toBe("END Number updated. Alerts now go to +254722000111");
    const { guardian, event } = await t.run(async (ctx) => ({
      guardian: await ctx.db.get(guardianId),
      event: await ctx.db
        .query("events")
        .withIndex("by_correlationId", (q) => q.eq("correlationId", currentSession))
        .unique(),
    }));
    expect(guardian?.msisdn).toBe("+254722000111");
    expect(event?.type).toBe("guardian.contact_updated");
    expect(event?.payload.previous_msisdn).toBe(GUARDIAN_MSISDN);
  });

  test("a replayed END screen does not flip the preference back", async () => {
    const t = convexTest(schema, modules);
    const guardianId = await seedWorld(t);
    await walk(t, ["4", "1"]);
    await dial(t, "4*1");
    const guardian = await t.run(async (ctx) => await ctx.db.get(guardianId));
    expect(guardian?.optedOutTypes).toEqual(["meal.tapped"]);
  });
});

describe("renderUssd screens (NFR-702)", () => {
  const longNames = ["Wanjiru Wambui Kamau", "Christopher Ochieng Otieno"];
  const guardian = (language: "en" | "sw", optedOutTypes: string[] = []): UssdGuardian => ({
    language,
    optedOutTypes,
    children: longNames.map((name) => ({
      name,
      balanceKes: 12345,
      today: "pending",
      history: PRIOR_DAYS.slice(1),
    })),
  });

  test("every screen is GSM-7 and fits the 182-character USSD limit in both languages", () => {
    const paths: string[][] = [[], ["1"], ["1", "1"], ["2", "2"], ["3", "1"], ["4"], ["4", "3"], ["5"], ["5", NEW_MSISDN], ["5", NEW_MSISDN, "1"], ["9"]];
    const allOff = NOTIFICATION_TYPES.map((type) => type.eventType);
    for (const language of ["en", "sw"] as const) {
      for (const optedOut of [[], allOff]) {
        for (const path of paths) {
          const { text } = renderUssd(guardian(language, optedOut), path);
          expect(text.length, `${language} ${path.join("*")}: ${text}`).toBeLessThanOrEqual(USSD_SCREEN_LIMIT);
          expect(isGsm7(text), `${language} ${path.join("*")}`).toBe(true);
        }
      }
    }
  });
});
