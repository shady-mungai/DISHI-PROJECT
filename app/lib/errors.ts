import { ConvexError } from "convex/values";

const SERVER_FAULT = "Something went wrong on our side. Please try again in a moment.";
const NO_CONNECTION = "Can't reach the server. Check your internet connection and try again.";
const CONVEX_TRANSPORT_MARKERS = ["[CONVEX", "[Request ID", "Server Error"];
const NETWORK_FAILURE_MARKERS = ["Failed to fetch", "NetworkError", "Load failed"];

const FRIENDLY_CODES: Record<string, string> = {
  NOT_AUTHENTICATED: "Your session has ended. Please sign in again.",
  NO_PROFILE: "Your account is not set up yet. Ask your administrator for access.",
  FORBIDDEN: "Your account doesn't have permission to do this.",
  OUT_OF_SCOPE: "You can only manage your own school's records.",
  student_not_in_school: "This pupil is not on this school's roll.",
  student_inactive: "This pupil has left the school, so this can't be recorded for them.",
  UNKNOWN_SCHOOL: "That school was not found. Choose a school from the list.",
  INVALID_PORTIONS: "Enter the number of portions as a whole number.",
  UNKNOWN_CODE: "That confirmation code is not recognised. Check it and try again.",
  INVALID_PREDICATE: "The rule condition is not valid. Check it and try again.",
  RULE_NOT_FOUND: "That notification rule no longer exists. Refresh the page.",
  DEVICE_NOT_FOUND: "That reader is no longer registered. Refresh the page.",
  SETTING_NOT_FOUND: "That setting no longer exists. Refresh the page.",
};

function includesAny(text: string, markers: ReadonlyArray<string>): boolean {
  return markers.some((marker) => text.includes(marker));
}

function fromServer(data: unknown, fallback: string): string {
  if (typeof data !== "string" || data.trim() === "") {
    return fallback;
  }
  return FRIENDLY_CODES[data] ?? data;
}

// One place turns any thrown value into a sentence a school user can act on:
// server messages are shown as written, codes are translated, and internals
// (request ids, stack traces) never reach the screen.
export function userMessage(caught: unknown, fallback: string): string {
  if (caught instanceof ConvexError) {
    return fromServer(caught.data, fallback);
  }
  if (!(caught instanceof Error)) {
    return fallback;
  }
  if (includesAny(caught.message, NETWORK_FAILURE_MARKERS)) {
    return NO_CONNECTION;
  }
  if (includesAny(caught.message, CONVEX_TRANSPORT_MARKERS)) {
    return SERVER_FAULT;
  }
  return caught.message || fallback;
}

export const ERROR_TOAST_EVENT = "mlo:error-toast";

export function toastError(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(ERROR_TOAST_EVENT, { detail: message }));
}

export function showError(caught: unknown, fallback: string): void {
  toastError(userMessage(caught, fallback));
}
