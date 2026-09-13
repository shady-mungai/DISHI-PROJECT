import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const userRole = v.union(
  v.literal("school"),
  v.literal("supplier"),
  v.literal("county"),
  v.literal("admin"),
);

export const settingValue = v.union(v.string(), v.number(), v.boolean());

export const expectationStatus = v.union(
  v.literal("pending"),
  v.literal("fulfilled"),
  v.literal("missed"),
);

export const eventPayload = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean()),
);

export const notificationStatus = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("failed"),
);

export const notificationChannel = v.literal("sms");

export const ruleAudience = v.literal("guardian");

export default defineSchema({
  users: defineTable({
    authUserId: v.string(),
    displayName: v.string(),
    role: userRole,
    schoolId: v.optional(v.id("schools")),
  }).index("by_authUserId", ["authUserId"]),

  schools: defineTable({
    code: v.string(),
    name: v.string(),
    active: v.boolean(),
  }).index("by_code", ["code"]),

  students: defineTable({
    schoolId: v.id("schools"),
    studentRef: v.string(),
    fullName: v.string(),
    className: v.string(),
    status: v.union(v.literal("active"), v.literal("deactivated")),
    deactivationReason: v.optional(v.string()),
  })
    .index("by_school_status", ["schoolId", "status"])
    .index("by_school_ref", ["schoolId", "studentRef"]),

  guardians: defineTable({
    msisdn: v.string(),
    displayName: v.string(),
    language: v.union(v.literal("en"), v.literal("sw")),
    optedOutTypes: v.array(v.string()),
    consentRecordedAt: v.optional(v.number()),
    consentBasis: v.optional(v.string()),
  }).index("by_msisdn", ["msisdn"]),

  guardianLinks: defineTable({
    guardianId: v.id("guardians"),
    studentId: v.id("students"),
    relationship: v.string(),
    active: v.boolean(),
  })
    .index("by_student", ["studentId"])
    .index("by_guardian", ["guardianId"]),

  tags: defineTable({
    tagUid: v.string(),
    studentId: v.id("students"),
    status: v.union(v.literal("active"), v.literal("revoked")),
    issuedAt: v.number(),
    revokedAt: v.optional(v.number()),
    revocationReason: v.optional(v.string()),
  })
    .index("by_tagUid", ["tagUid"])
    .index("by_student_status", ["studentId", "status"]),

  devices: defineTable({
    deviceRef: v.string(),
    schoolId: v.id("schools"),
    secretHash: v.string(),
    firmwareVersion: v.string(),
    queueDepth: v.number(),
    clockSkewSeconds: v.number(),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_deviceRef", ["deviceRef"])
    .index("by_school", ["schoolId"]),

  academicCalendar: defineTable({
    serviceDate: v.string(),
    isSchoolDay: v.boolean(),
    dayType: v.union(
      v.literal("full"),
      v.literal("half"),
      v.literal("exam"),
      v.literal("holiday"),
    ),
  }).index("by_serviceDate", ["serviceDate"]),

  events: defineTable({
    eventId: v.string(),
    type: v.string(),
    occurredAt: v.number(),
    recordedAt: v.number(),
    schemaVersion: v.number(),
    correlationId: v.string(),
    payload: eventPayload,
    schoolId: v.optional(v.id("schools")),
    sourceDeviceRef: v.optional(v.string()),
    studentId: v.optional(v.id("students")),
    serviceDate: v.optional(v.string()),
  })
    .index("by_eventId", ["eventId"])
    .index("by_type_occurredAt", ["type", "occurredAt"])
    .index("by_school_occurredAt", ["schoolId", "occurredAt"])
    .index("by_correlationId", ["correlationId"])
    .index("by_student_serviceDate_type", ["studentId", "serviceDate", "type"]),

  expectations: defineTable({
    schoolId: v.id("schools"),
    studentId: v.id("students"),
    serviceDate: v.string(),
    windowStart: v.number(),
    windowEnd: v.number(),
    cutoffAt: v.number(),
    status: expectationStatus,
  })
    .index("by_student_serviceDate", ["studentId", "serviceDate"])
    .index("by_school_serviceDate_status", ["schoolId", "serviceDate", "status"]),

  wallets: defineTable({
    studentId: v.id("students"),
    balanceKes: v.number(),
  }).index("by_student", ["studentId"]),

  rules: defineTable({
    key: v.string(),
    eventType: v.string(),
    predicate: v.string(),
    audience: ruleAudience,
    template: v.string(),
    channel: notificationChannel,
    priority: v.number(),
    enabled: v.boolean(),
  })
    .index("by_key", ["key"])
    .index("by_eventType", ["eventType"]),

  notifications: defineTable({
    dedupeKey: v.string(),
    ruleKey: v.string(),
    eventId: v.id("events"),
    correlationId: v.string(),
    schoolId: v.optional(v.id("schools")),
    guardianId: v.id("guardians"),
    msisdn: v.string(),
    channel: notificationChannel,
    body: v.string(),
    status: notificationStatus,
    providerMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    sentAt: v.optional(v.number()),
  })
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_correlationId", ["correlationId"])
    .index("by_providerMessageId", ["providerMessageId"])
    .index("by_school", ["schoolId"]),

  settings: defineTable({
    key: v.string(),
    value: settingValue,
    description: v.string(),
  }).index("by_key", ["key"]),
});
