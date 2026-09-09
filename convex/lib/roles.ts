import type { Infer } from "convex/values";
import type { userRole } from "../schema";

export type Role = Infer<typeof userRole>;

export type ScopeSubject = {
  role: Role;
  schoolId?: string;
};

export const AuthzFailure = {
  NotAuthenticated: "NOT_AUTHENTICATED",
  NoProfile: "NO_PROFILE",
  Forbidden: "FORBIDDEN",
  OutOfScope: "OUT_OF_SCOPE",
} as const;

const SCHOOL_SCOPED_ROLES: readonly Role[] = ["school"];

export function isRoleAllowed(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role);
}

export function isInSchoolScope(
  subject: ScopeSubject,
  targetSchoolId: string,
): boolean {
  if (!SCHOOL_SCOPED_ROLES.includes(subject.role)) {
    return true;
  }
  return subject.schoolId === targetSchoolId;
}
