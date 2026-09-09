/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as devices from "../devices.js";
import type * as enrolment from "../enrolment.js";
import type * as enrolment_parsePdf from "../enrolment/parsePdf.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_enrolmentParser from "../lib/enrolmentParser.js";
import type * as lib_hmac from "../lib/hmac.js";
import type * as lib_roles from "../lib/roles.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  devices: typeof devices;
  enrolment: typeof enrolment;
  "enrolment/parsePdf": typeof enrolment_parsePdf;
  http: typeof http;
  ingest: typeof ingest;
  "lib/authz": typeof lib_authz;
  "lib/dates": typeof lib_dates;
  "lib/enrolmentParser": typeof lib_enrolmentParser;
  "lib/hmac": typeof lib_hmac;
  "lib/roles": typeof lib_roles;
  seed: typeof seed;
  settings: typeof settings;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
