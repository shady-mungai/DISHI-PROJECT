# School Feeding Platform — Event Catalogue & Requirements

> Requirements baseline for the school feeding communication platform. Scope: Nairobi primary schools. Version 0.1 draft, 8 September 2026.
> 

## 1. Purpose and scope

The programme already moves food and money: the county funds a supplier, the supplier cooks in a central kitchen and delivers to schools, guardians pay a subsidised KES 5 per meal, and a student taps an NFC tag to release the meal. What the chain lacks is **communication**: guardians have no visibility of consumption, suppliers cook against estimates rather than evidence, schools absorb shortfalls silently, and the county sees totals long after they could act on them.

This document specifies the communication and reconciliation layer over that chain. It defines the event catalogue, per-actor acceptance milestones, and the functional and non-functional requirements used to validate the build.

**In scope**

- Event capture at the point of service (NFC tap, manual override)
- An event bus and rules engine driving multi-trigger notifications
- Guardian messaging over SMS and USSD
- Supplier dispatch declaration, school confirmation, and intra-day service monitoring
- Reconciliation of portions dispatched against portions consumed
- Operational dashboards for school, supplier and county roles

**Out of scope for v1**

- Payment rails (wallet top-up is consumed as an external event; no Daraja integration built here)
- Nutrition planning, menu design, procurement
- Hardware design of the NFC reader; the platform assumes a device that can queue offline and sync
- Non-public and community schools

---

## 2. Actors

| Actor | Primary interest | Channel |
| --- | --- | --- |
| Guardian | Did my child eat, and is there money left | SMS (push), USSD (pull) |
| Student | Collect a meal quickly, without being singled out | NFC tag at reader |
| School (head teacher, cook, patron) | Enough portions, minimal admin, no blame | Reader device, light web view |
| Supplier (central kitchen) | Get paid, cook the right quantity, be told early when something is wrong | Web dashboard, WhatsApp/SMS alerts |
| County programme officer | Leakage and exceptions, not averages | Web dashboard |
| System administrator | Device health, message deliverability, data quality | Admin console |

---

## 3. Trigger taxonomy

Every notification in the system is produced by one of seven trigger classes. The class determines the machinery required, so the taxonomy is the organising principle for the rules engine.

| Class | Fires when | Machinery required |
| --- | --- | --- |
| Event | A fact is recorded | Bus subscription |
| Absence | An expected fact did not arrive by a deadline | Materialised expectations + sweeper |
| Threshold | A monitored value crosses a boundary | Comparator with hysteresis |
| Window | An aggregate over a rolling period breaches a rule | Windowed aggregation state |
| Predictive | A model projects a future breach | Burn-rate / demand model |
| Reconciliation | Two independent streams disagree | Cross-stream join |
| Schedule | A calendar point is reached | Cron / batch |

### 3.1 The expectations table

Absence and predictive triggers cannot be served by querying for records that do not exist. At the start of each school day the system materialises one expectation row per enrolled student (expected tap within the service window, status `pending`). Taps flip rows to `fulfilled`. A sweeper at the cutoff emits `meal.missed` for rows still `pending`. The same pattern serves `delivery.unconfirmed`.

This single mechanism makes non-events observable and is a prerequisite for most of the notification value in this system.

---

## 4. Event catalogue

Naming convention: `domain.action`, past tense, immutable once emitted. Every event carries `event_id` (UUID, client-generated at the edge), `occurred_at`, `recorded_at`, `school_id`, `source_device_id`, and `schema_version`.

### 4.1 Identity and enrolment

| Event | Emitter | Class | Key payload | Consumers |
| --- | --- | --- | --- | --- |
| `student.enrolled` | Admin / roster import | Event | student_id, school_id, class, guardian_ref | Expectations, forecast |
| `student.tag_assigned` | School | Event | student_id, tag_uid, issued_at | Tap resolution |
| `student.tag_revoked` | School | Event | tag_uid, reason | Tap resolution, fraud watch |
| `student.deactivated` | Admin | Event | student_id, reason | Expectations, forecast |
| `guardian.linked` | Admin / school | Event | guardian_id, student_id, relationship | Notification routing |
| `guardian.contact_updated` | Guardian (USSD) / school | Event | guardian_id, msisdn, language | Notification routing |
| `guardian.preferences_updated` | Guardian (USSD) | Event | opt_in flags, quiet hours | Notification policy |

### 4.2 Meal service

| Event | Emitter | Class | Key payload | Consumers |
| --- | --- | --- | --- | --- |
| `meal.expectation_created` | Scheduler | Schedule | student_id, service_date, window_start, window_end | Sweeper, forecast |
| `meal.tapped` | Reader | Event | student_id, tag_uid, tapped_at, device_id | Guardian notify, wallet, counts |
| `meal.override_served` | School staff | Event | student_id, reason_code, staff_id | Counts, integrity metrics |
| `meal.duplicate_rejected` | Ingestion | Event | event_id, original_event_id | Integrity metrics |
| `meal.missed` | Sweeper | **Absence** | student_id, service_date, expectation_id | Guardian notify, welfare |
| `meal.tap_anomaly_detected` | Analyser | Window | school_id, pattern, tap_count, interval | County, admin |

`meal.tap_anomaly_detected` covers batched tapping: real service queues spread taps over tens of minutes, fabricated ones cluster. Inter-tap interval distribution is the detector.

### 4.3 Wallet

Balances are mirrored from the external payment system; this platform emits communication events only.

| Event | Emitter | Class | Key payload | Consumers |
| --- | --- | --- | --- | --- |
| `wallet.topped_up` | Payment adapter | Event | student_id, amount, new_balance | Guardian notify |
| `wallet.debited` | Tap handler | Event | student_id, amount, new_balance | Threshold monitor |
| `wallet.low_balance` | Monitor | **Threshold** | student_id, balance, threshold | Guardian notify |
| `wallet.depleted` | Monitor | Threshold | student_id | Guardian notify, school |
| `wallet.depletion_forecast` | Model | **Predictive** | student_id, projected_date, meals_remaining | Guardian notify |

Thresholds apply hysteresis: `low_balance` re-arms only after the balance rises above the threshold plus a margin, so a wallet hovering at the boundary does not emit repeatedly.

### 4.4 Supply chain

| Event | Emitter | Class | Key payload | Consumers |
| --- | --- | --- | --- | --- |
| `demand.forecast_published` | Model (overnight) | Schedule | school_id, service_date, portions_forecast, confidence | Supplier, school |
| `delivery.dispatched` | Supplier (WhatsApp/web) | Event | school_id, portions, vehicle, dispatched_at, docket_ref | School, reconciliation |
| `delivery.confirmed` | School (staff tag / code) | Event | delivery_id, portions_received, confirmed_by | Reconciliation, payment file |
| `delivery.disputed` | School | Event | delivery_id, portions_received, note | County, supplier |
| `delivery.unconfirmed` | Sweeper | **Absence** | school_id, expected_by | Supplier, county |
| `delivery.shortfall_detected` | Comparator | Threshold | school_id, forecast, received, gap | Supplier, county, school |
| `service.stalled` | Intra-day monitor | Window | school_id, taps_so_far, expected_run_rate, at_time | Supplier, school, admin |

`service.stalled` is the highest-value real-time event for suppliers: at 13:15 a school running at 30% of its expected rate has a problem that is still fixable today.

### 4.5 Reconciliation and integrity

| Event | Emitter | Class | Key payload | Consumers |
| --- | --- | --- | --- | --- |
| `reconciliation.daily_computed` | Batch | Schedule | school_id, dispatched, confirmed, consumed, variance | County, supplier |
| `reconciliation.variance_exceeded` | Batch | **Reconciliation** | school_id, variance_pct, streak_days | County |
| `integrity.override_rate_exceeded` | Analyser | Window | school_id, override_pct, period | County, admin |
| `welfare.consecutive_misses` | Analyser | Window | student_id, miss_count, period | Guardian, school |

### 4.6 Device and platform operations

| Event | Emitter | Class | Key payload | Consumers |
| --- | --- | --- | --- | --- |
| `device.sync_completed` | Reader | Event | device_id, events_pushed, queue_depth | Admin |
| `device.heartbeat_missed` | Monitor | Absence | device_id, school_id, last_seen | Admin, school |
| `device.clock_skew_detected` | Ingestion | Threshold | device_id, skew_seconds | Admin |
| `notification.queued` | Rules engine | Event | notification_id, recipient, template, priority | Policy layer |
| `notification.sent` | Gateway adapter | Event | notification_id, gateway_ref, segments, cost | Cost reporting |
| `notification.delivered` | Gateway DLR | Event | notification_id, delivered_at | Deliverability |
| `notification.failed` | Gateway DLR | Event | notification_id, failure_reason | Data quality queue |
| `notification.suppressed` | Policy layer | Event | notification_id, suppression_reason | Tuning, audit |

`notification.suppressed` exists so the messages the governor withheld remain auditable. Without it, tuning the policy layer is guesswork.

---

## 5. Requirements per actor (validation milestones)

Each bullet is an observable outcome and doubles as an acceptance test. A milestone passes only when it can be demonstrated end to end on the pilot deployment.

### 5.1 Guardian (P)

- **P-01** Receives an SMS within 60 seconds of their child's first successful tap of the day, naming the child and the meal date.
- **P-02** Receives an SMS when their child has **not** tapped by the configured cutoff on a school day, and receives nothing on non-school days.
- **P-03** Receives a low-balance warning once when the balance crosses the threshold downward, and does not receive it again until the balance has recovered above the threshold plus margin.
- **P-04** Receives a predictive warning naming the date the balance will run out, at least two school days before it does.
- **P-05** Receives a weekly digest stating meals taken out of meals possible and the closing balance.
- **P-06** Receives no more than the configured daily cap of messages, with lower-priority messages collapsed or dropped rather than queued behind the cap.
- **P-07** Can dial a USSD short code and retrieve, within one session, their child's status today, current balance, and last five meal days.
- **P-08** Can opt out of any individual notification type via USSD, and the opt-out takes effect on the next triggering event.
- **P-09** Can update the notification MSISDN via USSD or through the school, with the change audited.
- **P-10** Receives messages in the language recorded on their profile.
- **P-11** A guardian with multiple enrolled children receives one merged message per event window rather than one per child.

### 5.2 Student (ST)

- **ST-01** A tap on a valid tag releases a meal decision in under one second at the reader, with no dependency on network availability.
- **ST-02** A student with a zero balance or on full subsidy is served through a path that is visually and audibly indistinguishable at the reader from a paying student.
- **ST-03** A student with a lost, forgotten or damaged tag can still be served through a staff override that records a reason code.
- **ST-04** A second tap by the same student on the same meal day is rejected as a duplicate and does not debit the wallet.
- **ST-05** A tag reported lost cannot be used to obtain a meal from the moment revocation reaches the device.

### 5.3 School (SC)

- **SC-01** Sees tomorrow's forecast portion count for the school before the end of the current service day.
- **SC-02** Can confirm or dispute a delivery in under 30 seconds, using a staff tag or a one-time code, without a laptop.
- **SC-03** Sees a live count of meals served against expected for the current day.
- **SC-04** Is alerted when a reader has stopped reporting, before the next service window opens.
- **SC-05** Can issue an override with a reason code, and the school's override rate is visible to the school itself, not only to the county.
- **SC-06** Can flag a roster correction (student left, student joined, tag reissued) that takes effect on the next day's expectations.
- **SC-07** No routine school task in the service window requires more than 10 seconds of a staff member's attention per student.

### 5.4 Supplier (SU)

- **SU-01** Receives the next day's forecast portion count per school on a fixed overnight schedule, in time for the cooking cycle.
- **SU-02** Can declare a dispatch (school, portions, docket reference, timestamp) through WhatsApp or web in under 60 seconds.
- **SU-03** Cannot have a dispatch counted as delivered until the receiving school independently confirms it.
- **SU-04** Receives an alert during the service window when any school is materially behind its expected consumption rate.
- **SU-05** Receives an alert when a delivery remains unconfirmed past the expected confirmation time.
- **SU-06** Sees, per school and per day, portions dispatched, portions confirmed and portions consumed, with the variance computed.
- **SU-07** A dispatch declaration is the sole trigger for the school's line on the payment reconciliation file; no declaration, no line.
- **SU-08** Sees forecast accuracy for the trailing period, so the forecast can be challenged with evidence.

### 5.5 County programme officer (GV)

- **GV-01** Sees meals consumed per school per day, with the day's figure available before the next service day begins.
- **GV-02** Sees the dispatched / confirmed / consumed variance per school, ranked by size, not alphabetically.
- **GV-03** Is alerted when a school's variance exceeds the configured tolerance for a configured number of consecutive days.
- **GV-04** Sees override rate by school and is alerted when it exceeds tolerance.
- **GV-05** Sees tap-pattern anomaly flags with the supporting evidence, not only a score.
- **GV-06** Can export any dashboard view for the reporting period as a file.
- **GV-07** Sees programme-level totals (schools active, meals served, guardians reached, message deliverability) on a single screen.
- **GV-08** Can drill from any aggregate figure to the underlying events that produced it.

### 5.6 System administrator (AD)

- **AD-01** Sees device fleet status: last heartbeat, queue depth, firmware version, clock skew.
- **AD-02** Sees notification deliverability by day and by failure reason.
- **AD-03** Receives a work queue of undeliverable MSISDNs for correction by the relevant school.
- **AD-04** Can add, amend or disable a notification rule without a code deployment.
- **AD-05** Can replay a rule against historical events in a dry-run mode that reports what would have been sent, and sends nothing.
- **AD-06** Sees notification spend for the period, broken down by trigger type.
- **AD-07** Can trace any delivered message back to the originating event through a single identifier.

---

## 6. Functional requirements

### FR-100 Identity and enrolment

- **FR-101** The system shall maintain a student roster per school with a unique student identifier, class, and status.
- **FR-102** The system shall bind zero or more NFC tag UIDs to a student, with only one active binding at a time.
- **FR-103** The system shall support tag revocation and reissue, propagating revocation to reader devices on their next sync.
- **FR-104** The system shall link one or more guardians to a student, each with an MSISDN, language, and notification preferences.
- **FR-105** The system shall support bulk roster import and per-record correction, retaining an audit trail of changes.
- **FR-106** The system shall treat the roster as the source for daily expectation generation.

### FR-200 Meal service and event ingestion

- **FR-201** Reader devices shall resolve a tap to a serve/deny decision using locally cached roster and entitlement data, without network access.
- **FR-202** Reader devices shall persist tap events locally and transmit them when connectivity is available, retaining at least 72 hours of events.
- **FR-203** Each tap event shall carry a device-generated UUID; the ingestion service shall reject duplicates idempotently on that identifier.
- **FR-204** The system shall enforce one countable meal per student per meal period per service date, regardless of the number of taps received.
- **FR-205** The system shall accept staff-initiated overrides carrying a reason code and the acting staff identifier.
- **FR-206** The system shall record both `occurred_at` (device clock) and `recorded_at` (server clock) and flag events whose skew exceeds tolerance.
- **FR-207** The system shall generate meal expectation records for every active student at the start of each school day, per the academic calendar.
- **FR-208** The system shall emit a missed-meal event for every expectation still unfulfilled at the configured cutoff.

### FR-300 Wallet interface

- **FR-301** The system shall consume top-up and balance events from the external payment system through an adapter with a defined contract.
- **FR-302** The system shall maintain a mirrored balance per student sufficient to drive threshold and predictive triggers.
- **FR-303** The system shall never block meal service on wallet state; entitlement decisions shall fall back to serve-and-record when balance data is unavailable.
- **FR-304** The system shall compute a burn rate per student and project the balance depletion date.

### FR-400 Event bus and rules engine

- **FR-401** All state changes shall be published to an append-only event log as immutable, versioned events.
- **FR-402** The rules engine shall support the seven trigger classes defined in section 3.
- **FR-403** Notification rules shall be defined as data (condition, audience, template, priority, channel), editable without redeployment.
- **FR-404** The rules engine shall support dry-run evaluation against historical events, producing a report and sending nothing.
- **FR-405** The system shall maintain materialised expectation records to support absence triggers.
- **FR-406** Threshold rules shall support hysteresis and re-arm conditions.
- **FR-407** Window rules shall support rolling aggregation over a configurable period.

### FR-500 Notification delivery

- **FR-501** The notification policy layer shall apply, in order: opt-out filtering, quiet hours, deduplication, collapse window, priority ranking, per-recipient rate cap.
- **FR-502** Messages suppressed by policy shall be recorded with a suppression reason.
- **FR-503** Multiple triggers for one recipient within the collapse window shall be composed into a single message.
- **FR-504** A guardian with multiple children shall receive one merged message per collapse window.
- **FR-505** Message templates shall be parameterised, versioned, and available per language.
- **FR-506** The system shall compose messages within 160 GSM-7 characters and shall warn at authoring time when a template can exceed one segment.
- **FR-507** The system shall record gateway delivery reports against each message and expose failure reasons.
- **FR-508** The system shall expose a USSD menu supporting child status, balance, recent meal history, preference changes, and MSISDN update.
- **FR-509** Supplier and school alerts shall be deliverable over WhatsApp with SMS fallback.

### FR-600 Supply chain and reconciliation

- **FR-601** The system shall publish a per-school portion forecast for the next service day on an overnight schedule.
- **FR-602** The forecast shall incorporate trailing consumption, day-of-week effects, and the academic calendar.
- **FR-603** Suppliers shall be able to declare a dispatch through a structured conversational flow or web form.
- **FR-604** A dispatch shall require independent confirmation by the receiving school before being treated as delivered.
- **FR-605** The system shall emit an unconfirmed-delivery event when confirmation does not arrive by the expected time.
- **FR-606** The system shall compute, per school per day, dispatched, confirmed and consumed portions, and the resulting variance.
- **FR-607** The system shall monitor intra-day consumption against the expected run rate and emit a stalled-service event on material deviation.
- **FR-608** The system shall produce a payment reconciliation file derived solely from confirmed deliveries.

### FR-700 Dashboards and reporting

- **FR-701** The system shall provide role-scoped dashboards for school, supplier, county and administrator.
- **FR-702** Dashboards shall present exceptions ranked by magnitude ahead of aggregate totals.
- **FR-703** Every aggregate figure shall be traceable to its constituent events.
- **FR-704** Dashboards shall support export of the current view for the selected period.
- **FR-705** The county view shall surface variance streaks, override rates and tap-pattern anomalies with supporting evidence.

### FR-800 Administration, audit and simulation

- **FR-801** The system shall enforce role-based access control across all interfaces.
- **FR-802** All administrative actions shall be recorded in an immutable audit log.
- **FR-803** The system shall expose device fleet health and notification deliverability to administrators.
- **FR-804** The system shall provide an event simulator capable of generating synthetic service days, including configurable failure and misconduct scenarios, for testing the rules engine and dashboards.

---

## 7. Non-functional requirements

### NFR-100 Performance

- **NFR-101** Reader serve/deny decision: under 500 ms at the device, 99th percentile.
- **NFR-102** Tap ingestion to notification enqueued: under 3 seconds, 95th percentile, when the device is online.
- **NFR-103** Tap to guardian handset: under 60 seconds, 95th percentile, subject to gateway performance.
- **NFR-104** Missed-meal sweep across the full pilot roster: complete within 5 minutes of the cutoff.
- **NFR-105** Dashboard initial render: under 2 seconds on a 3G connection.
- **NFR-106** Overnight forecast generation for all schools: complete within 30 minutes.

### NFR-200 Availability and resilience

- **NFR-201** Meal service shall never be blocked by platform unavailability; readers shall serve autonomously for at least 72 hours offline.
- **NFR-202** Backend API availability: 99.5% monthly, measured within the service window.
- **NFR-203** No tap event shall be lost as a result of connectivity loss, device restart, or backend downtime.
- **NFR-204** Event ingestion shall be idempotent; replaying a device queue shall not alter counts.
- **NFR-205** Notification delivery failures shall be retried with backoff up to a configured limit, then recorded as failed.

### NFR-300 Scalability

- **NFR-301** Sustain 2,000 tap events per minute with the stated latency targets.
- **NFR-302** Support a service-window burst equal to the full roster of the largest school within 45 minutes.
- **NFR-303** Architecture shall accommodate growth from pilot scale to 350,000 students without redesign of the ingestion or event model.
- **NFR-304** Notification throughput shall not become the bottleneck for consumption reporting; the two paths shall be decoupled.

### NFR-400 Security

- **NFR-401** All transport encrypted with TLS 1.2 or above.
- **NFR-402** Reader devices shall authenticate with per-device credentials; events shall be signed such that a rogue device cannot inject events attributed to another.
- **NFR-403** Sensitive data at rest shall be encrypted.
- **NFR-404** Access shall be role-based and least-privilege; no role shall see student-level data outside its own scope.
- **NFR-405** Administrative and override actions shall be attributable to an individual.
- **NFR-406** A compromised or lost device shall be revocable centrally, taking effect on next contact.

### NFR-500 Privacy and compliance

- **NFR-501** Processing shall comply with the Data Protection Act 2019, including the provisions applying to children's personal data.
- **NFR-502** Data collection shall be minimised: student identifier, class, tag binding, guardian MSISDN and language preference. No biometric, health or household data.
- **NFR-503** Guardian consent for notifications shall be recorded, with the basis and timestamp, and shall be withdrawable.
- **NFR-504** Message content shall not disclose a student's subsidy status or ability to pay to any party other than the linked guardian.
- **NFR-505** Retention periods shall be defined per data class, with student-level records purged or de-identified after the retention period.
- **NFR-506** Registration with the Office of the Data Protection Commissioner shall be completed before live guardian data is processed.
- **NFR-507** Data subject requests (access, correction, erasure) shall be servable within the statutory period.

### NFR-600 Cost efficiency

- **NFR-601** Outbound SMS per guardian shall not exceed 25 messages per term at steady state.
- **NFR-602** The notification policy layer shall demonstrate at least a 55% reduction in message volume against a naive per-tap baseline, with no loss of actionable alerts.
- **NFR-603** Templates shall not exceed one SMS segment except where explicitly approved.
- **NFR-604** Guardian-initiated USSD shall be available for all pull-style enquiries, so that routine curiosity does not incur platform-borne cost.
- **NFR-605** Notification spend shall be reportable per trigger type, so that low-value rules can be identified and retired.

### NFR-700 Usability and accessibility

- **NFR-701** Guardian messages shall be comprehensible to a reader with basic literacy: short sentences, no jargon, no abbreviations beyond the currency code.
- **NFR-702** All guardian-facing functionality shall be operable on a feature phone.
- **NFR-703** USSD flows shall complete within a single session and within the network session timeout.
- **NFR-704** School-facing interactions during the service window shall be operable one-handed and without a keyboard.
- **NFR-705** Message content shall be available in English and Kiswahili.

### NFR-800 Maintainability and observability

- **NFR-801** Notification rules shall be changeable as configuration, not code.
- **NFR-802** Every notification shall be traceable to its originating event through a correlation identifier.
- **NFR-803** The system shall expose metrics for ingestion lag, sweep duration, rule evaluation counts, suppression counts and delivery rates.
- **NFR-804** Event schemas shall be versioned, with consumers tolerant of additive change.
- **NFR-805** The simulator shall be able to reproduce a full service day deterministically from a seed, for regression testing.

---

## 8. Assumptions

- Reader hardware exists and can cache roster data, queue events offline, and sync over GSM or Wi-Fi.
- Wallet balances and top-ups are owned by an external payment system exposing an integrable interface.
- Schools have at least one staff member available to confirm deliveries during the delivery window.
- Suppliers have smartphone access at kitchen-manager level; kitchen floor staff may not.
- The academic calendar, including half-days and examination periods, is available to the platform.

## 9. Open questions

- Which party owns guardian consent capture at enrolment, and what is the fallback where a guardian is unreachable?
- What variance tolerance does the county consider actionable, and over how many consecutive days?
- Is the payment reconciliation file consumed by an existing county finance system, and in what format?
- What is the agreed cutoff time for the missed-meal sweep, and does it vary by school?
- Who arbitrates a disputed delivery, and within what timeframe?
- Does the supplier WhatsApp channel run on the WhatsApp Business API, and who holds the sender identity?