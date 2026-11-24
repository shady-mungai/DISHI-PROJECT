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
  v.literal("absent"),
);

export const missReason = v.union(v.literal("supply"), v.literal("present"), v.literal("unknown"));

export const eventPayload = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean()),
);

export const notificationStatus = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("failed"),
  v.literal("suppressed"),
);

export const guardianLanguage = v.union(v.literal("en"), v.literal("sw"));

export const localisedTemplates = v.object({ en: v.string(), sw: v.string() });

export const notificationChannel = v.literal("sms");

export const ruleAudience = v.literal("guardian");

export const deliveryStatus = v.union(
  v.literal("declared"),
  v.literal("unconfirmed"),
  v.literal("confirmed"),
  v.literal("disputed"),
);

export const overrideReason = v.union(
  v.literal("lost_tag"),
  v.literal("forgotten_tag"),
  v.literal("damaged_tag"),
  v.literal("reader_down"),
);

export const forecastConfidence = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));

export const photoReview = v.union(v.literal("pending"), v.literal("clear"), v.literal("flagged"), v.literal("failed"));
export const photoFindings = v.object({ foodVisible: v.boolean(), clarity: v.union(v.literal("clear"), v.literal("unclear")), unrelatedContent: v.boolean(), description: v.string() });

export const dayAttendance = v.object({
  registerTaken: v.boolean(),
  absent: v.number(),
  missedPresent: v.number(),
  missedSupply: v.number(),
  missedUnknown: v.number(),
});

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
    deactivatedAt: v.optional(v.number()),
  })
    .index("by_school_status", ["schoolId", "status"])
    .index("by_school_ref", ["schoolId", "studentRef"]),

  guardians: defineTable({
    msisdn: v.string(),
    displayName: v.string(),
    language: guardianLanguage,
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
    revokedAt: v.optional(v.number()),
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
    .index("by_student_serviceDate_type", ["studentId", "serviceDate", "type"])
    .index("by_school_type_serviceDate", ["schoolId", "type", "serviceDate"]),

  expectations: defineTable({
    schoolId: v.id("schools"),
    studentId: v.id("students"),
    serviceDate: v.string(),
    windowStart: v.number(),
    windowEnd: v.number(),
    cutoffAt: v.number(),
    status: expectationStatus,
    missReason: v.optional(missReason),
  })
    .index("by_student_serviceDate", ["studentId", "serviceDate"])
    .index("by_school_serviceDate_status", ["schoolId", "serviceDate", "status"]),

  wallets: defineTable({
    studentId: v.id("students"),
    balanceKes: v.number(),
    lowBalanceArmed: v.optional(v.boolean()),
    updatedAt: v.optional(v.number()),
  }).index("by_student", ["studentId"]),

  rules: defineTable({
    key: v.string(),
    eventType: v.string(),
    predicate: v.string(),
    audience: ruleAudience,
    templates: localisedTemplates,
    templateVersion: v.number(),
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
    segments: v.number(),
    templateVersion: v.optional(v.number()),
    status: notificationStatus,
    suppressionReason: v.optional(v.string()),
    deliverAt: v.optional(v.number()),
    collapsedInto: v.optional(v.id("notifications")),
    providerMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    attempts: v.optional(v.number()),
  })
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_guardian", ["guardianId"])
    .index("by_correlationId", ["correlationId"])
    .index("by_providerMessageId", ["providerMessageId"])
    .index("by_collapsedInto", ["collapsedInto"])
    .index("by_school", ["schoolId"]),

  deliveries: defineTable({
    schoolId: v.id("schools"),
    serviceDate: v.string(),
    portions: v.number(),
    vehicle: v.optional(v.string()),
    docketRef: v.string(),
    dispatchedAt: v.number(),
    declaredBy: v.id("users"),
    confirmCodeHash: v.string(),
    expectedConfirmBy: v.number(),
    status: deliveryStatus,
    portionsReceived: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    note: v.optional(v.string()),
    workflowVersion: v.optional(v.number()),
    reference: v.optional(v.string()),
    requestKey: v.optional(v.string()),
    requestFingerprint: v.optional(v.string()),
    expectedArrivalAt: v.optional(v.number()),
    overdueAt: v.optional(v.number()),
    receiptRecordedAt: v.optional(v.number()),
    receiptConfirmedAt: v.optional(v.number()),
    receiptBy: v.optional(v.id("users")),
    receiptMethod: v.optional(v.union(v.literal("photo"), v.literal("code"))),
    reportedProblem: v.optional(v.string()),
    evidenceId: v.optional(v.id("deliveryEvidence")),
    missingEvidence: v.optional(v.boolean()),
    reviewRequired: v.optional(v.boolean()),
    reviewResolvedAt: v.optional(v.number()),
    photoReview: v.optional(photoReview),
    photoGeneration: v.optional(v.number()),
    photoAttempts: v.optional(v.number()),
    photoModel: v.optional(v.string()),
    photoAssessedAt: v.optional(v.number()),
    photoFindings: v.optional(photoFindings),
    photoError: v.optional(v.string()),
    dish: v.optional(v.string()),
  })
    .index("by_school_serviceDate", ["schoolId", "serviceDate"])
    .index("by_school_confirmCodeHash", ["schoolId", "confirmCodeHash"])
    .index("by_status_serviceDate", ["status", "serviceDate"])
    .index("by_serviceDate", ["serviceDate"])
    .index("by_requestKey", ["requestKey"])
    .index("by_declaredBy_and_serviceDate", ["declaredBy", "serviceDate"])
    .index("by_declaredBy_and_status", ["declaredBy", "status"])
    .index("by_schoolId_and_status", ["schoolId", "status"])
    .index("by_reviewRequired", ["reviewRequired"]),

  deliveryEvidence: defineTable({
    deliveryId: v.id("deliveries"), uploadedBy: v.id("users"), storageId: v.id("_storage"),
    contentType: v.string(), size: v.number(), requestKey: v.string(),
  }).index("by_requestKey", ["requestKey"]),

  receiptCodes: defineTable({
    deliveryId: v.id("deliveries"), hash: v.string(), expiresAt: v.number(), generation: v.number(),
    portionsReceived: v.number(), problem: v.string(), requestedBy: v.id("users"),
    usedAt: v.optional(v.number()), failures: v.number(), cooldownUntil: v.optional(v.number()),
  }).index("by_deliveryId", ["deliveryId"]),

  deliveryOperations: defineTable({
    key: v.string(), fingerprint: v.string(), deliveryId: v.id("deliveries"),
    status: v.string(), expiresAt: v.optional(v.number()),
  }).index("by_key", ["key"]),

  deliveryTimeline: defineTable({
    deliveryId: v.id("deliveries"), at: v.number(), type: v.string(),
    actorId: v.optional(v.id("users")), detail: v.string(),
  }).index("by_deliveryId", ["deliveryId"]),

  operationalContacts: defineTable({
    recipientKey: v.string(), name: v.string(), msisdn: v.string(), active: v.boolean(),
  }).index("by_recipientKey", ["recipientKey"]),

  deliveryInbox: defineTable({
    recipientKey: v.string(), dedupeKey: v.string(), deliveryId: v.id("deliveries"),
    body: v.string(), readAt: v.optional(v.number()),
  }).index("by_recipientKey", ["recipientKey"]).index("by_dedupeKey", ["dedupeKey"]),

  deliverySms: defineTable({
    deliveryId: v.id("deliveries"), recipientKey: v.string(), dedupeKey: v.string(),
    msisdn: v.optional(v.string()), body: v.string(),
    status: v.union(v.literal("queued"), v.literal("sending"), v.literal("sent"), v.literal("failed")),
    failureReason: v.optional(v.string()), providerMessageId: v.optional(v.string()), attempts: v.number(),
  }).index("by_dedupeKey", ["dedupeKey"]).index("by_deliveryId", ["deliveryId"]).index("by_status", ["status"]),

  forecasts: defineTable({
    schoolId: v.id("schools"),
    serviceDate: v.string(),
    portions: v.number(),
    confidence: forecastConfidence,
    computedAt: v.number(),
  }).index("by_school_serviceDate", ["schoolId", "serviceDate"]),

  reconciliations: defineTable({
    schoolId: v.id("schools"),
    serviceDate: v.string(),
    dispatched: v.number(),
    confirmed: v.number(),
    received: v.optional(v.number()),
    consumed: v.number(),
    variance: v.number(),
    variancePct: v.number(),
    computedAt: v.number(),
    attendance: v.optional(dayAttendance),
  }).index("by_school_serviceDate", ["schoolId", "serviceDate"]),

  registers: defineTable({
    schoolId: v.id("schools"),
    serviceDate: v.string(),
    absentStudentIds: v.array(v.id("students")),
    takenBy: v.id("users"),
    takenAt: v.number(),
  }).index("by_schoolId_and_serviceDate", ["schoolId", "serviceDate"]),

  settings: defineTable({
    key: v.string(),
    value: settingValue,
    description: v.string(),
  }).index("by_key", ["key"]),
});
