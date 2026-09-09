import { describe, expect, test } from "vitest";
import { isInSchoolScope, isRoleAllowed, type Role } from "../lib/roles";

const SCHOOL_A = "school_a";
const SCHOOL_B = "school_b";

describe("isRoleAllowed (FR-801)", () => {
  test("admits a role present in the allow list", () => {
    expect(isRoleAllowed("county", ["county", "admin"])).toBe(true);
  });

  test("rejects a role absent from the allow list", () => {
    expect(isRoleAllowed("supplier", ["county", "admin"])).toBe(false);
  });

  test("rejects every role against an empty allow list", () => {
    const everyRole: Role[] = ["school", "supplier", "county", "admin"];
    for (const role of everyRole) {
      expect(isRoleAllowed(role, [])).toBe(false);
    }
  });
});

describe("isInSchoolScope (NFR-404)", () => {
  test("a school user reaches its own school", () => {
    expect(isInSchoolScope({ role: "school", schoolId: SCHOOL_A }, SCHOOL_A)).toBe(true);
  });

  test("a school user cannot reach another school", () => {
    expect(isInSchoolScope({ role: "school", schoolId: SCHOOL_A }, SCHOOL_B)).toBe(false);
  });

  test("a school user with no school assigned reaches nothing", () => {
    expect(isInSchoolScope({ role: "school" }, SCHOOL_A)).toBe(false);
  });

  test("county and admin are not school-scoped", () => {
    expect(isInSchoolScope({ role: "county" }, SCHOOL_A)).toBe(true);
    expect(isInSchoolScope({ role: "admin" }, SCHOOL_B)).toBe(true);
  });
});
