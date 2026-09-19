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
import type * as channels from "../channels.js";
import type * as crons from "../crons.js";
import type * as deliveries from "../deliveries.js";
import type * as devices from "../devices.js";
import type * as digest from "../digest.js";
import type * as enrolment from "../enrolment.js";
import type * as enrolment_parsePdf from "../enrolment/parsePdf.js";
import type * as expectations from "../expectations.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_channels_africasTalking from "../lib/channels/africasTalking.js";
import type * as lib_channels_celcom from "../lib/channels/celcom.js";
import type * as lib_channels_console from "../lib/channels/console.js";
import type * as lib_channels_index from "../lib/channels/index.js";
import type * as lib_channels_types from "../lib/channels/types.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_deliveryReport from "../lib/deliveryReport.js";
import type * as lib_enrolmentParser from "../lib/enrolmentParser.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_gsm7 from "../lib/gsm7.js";
import type * as lib_hmac from "../lib/hmac.js";
import type * as lib_mask from "../lib/mask.js";
import type * as lib_policy from "../lib/policy.js";
import type * as lib_predicate from "../lib/predicate.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_simulation from "../lib/simulation.js";
import type * as lib_supply from "../lib/supply.js";
import type * as lib_tagUid from "../lib/tagUid.js";
import type * as lib_template from "../lib/template.js";
import type * as lib_ussd from "../lib/ussd.js";
import type * as lib_wallet_payments from "../lib/wallet/payments.js";
import type * as lib_wallet_threshold from "../lib/wallet/threshold.js";
import type * as notifications from "../notifications.js";
import type * as readers from "../readers.js";
import type * as rules from "../rules.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as simulator from "../simulator.js";
import type * as users from "../users.js";
import type * as ussd from "../ussd.js";
import type * as wallets from "../wallets.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  channels: typeof channels;
  crons: typeof crons;
  deliveries: typeof deliveries;
  devices: typeof devices;
  digest: typeof digest;
  enrolment: typeof enrolment;
  "enrolment/parsePdf": typeof enrolment_parsePdf;
  expectations: typeof expectations;
  http: typeof http;
  ingest: typeof ingest;
  "lib/authz": typeof lib_authz;
  "lib/channels/africasTalking": typeof lib_channels_africasTalking;
  "lib/channels/celcom": typeof lib_channels_celcom;
  "lib/channels/console": typeof lib_channels_console;
  "lib/channels/index": typeof lib_channels_index;
  "lib/channels/types": typeof lib_channels_types;
  "lib/dates": typeof lib_dates;
  "lib/deliveryReport": typeof lib_deliveryReport;
  "lib/enrolmentParser": typeof lib_enrolmentParser;
  "lib/events": typeof lib_events;
  "lib/gsm7": typeof lib_gsm7;
  "lib/hmac": typeof lib_hmac;
  "lib/mask": typeof lib_mask;
  "lib/policy": typeof lib_policy;
  "lib/predicate": typeof lib_predicate;
  "lib/roles": typeof lib_roles;
  "lib/simulation": typeof lib_simulation;
  "lib/supply": typeof lib_supply;
  "lib/tagUid": typeof lib_tagUid;
  "lib/template": typeof lib_template;
  "lib/ussd": typeof lib_ussd;
  "lib/wallet/payments": typeof lib_wallet_payments;
  "lib/wallet/threshold": typeof lib_wallet_threshold;
  notifications: typeof notifications;
  readers: typeof readers;
  rules: typeof rules;
  seed: typeof seed;
  settings: typeof settings;
  simulator: typeof simulator;
  users: typeof users;
  ussd: typeof ussd;
  wallets: typeof wallets;
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
