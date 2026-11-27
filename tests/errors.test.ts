import { ConvexError } from "convex/values";
import { describe, expect, test, vi } from "vitest";
import { ERROR_TOAST_EVENT, showError, userMessage } from "../app/lib/errors";

const FALLBACK = "Could not save.";

describe("userMessage", () => {
  test("shows a server sentence as written", () => {
    expect(userMessage(new ConvexError("The register for today closed at the meal cutoff."), FALLBACK)).toBe(
      "The register for today closed at the meal cutoff.",
    );
  });

  test("translates server codes into sentences", () => {
    expect(userMessage(new ConvexError("OUT_OF_SCOPE"), FALLBACK)).toBe("You can only manage your own school's records.");
    expect(userMessage(new ConvexError("student_inactive"), FALLBACK)).not.toContain("student_inactive");
  });

  test("never shows request ids or stack traces from an unexpected server error", () => {
    const raw = new Error("[CONVEX M(attendance:submit)] [Request ID: 6bf5d4af577f2901] Server Error Uncaught Error: boom at handler (../convex/attendance.ts:91:11)");
    const shown = userMessage(raw, FALLBACK);
    expect(shown).not.toMatch(/Request ID|CONVEX|attendance\.ts/);
    expect(shown).toBe("Something went wrong on our side. Please try again in a moment.");
  });

  test("explains a lost connection", () => {
    expect(userMessage(new TypeError("Failed to fetch"), FALLBACK)).toContain("internet connection");
  });

  test("showError hands the friendly sentence to the toaster", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const shown: string[] = [];
    target.addEventListener(ERROR_TOAST_EVENT, (event) => shown.push((event as CustomEvent<string>).detail));
    showError(new ConvexError("FORBIDDEN"), FALLBACK);
    vi.unstubAllGlobals();
    expect(shown).toEqual(["Your account doesn't have permission to do this."]);
  });

  test("falls back when nothing readable was thrown", () => {
    expect(userMessage("boom", FALLBACK)).toBe(FALLBACK);
    expect(userMessage(new ConvexError({ code: 1 }), FALLBACK)).toBe(FALLBACK);
  });
});
