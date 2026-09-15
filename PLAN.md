# Dishi — MVP Build Plan

**Source scope:** `School Feeding Platform — Event Catalogue & Requirements` v0.1 (8 Sep 2026)
**Target:** demonstrable pilot MVP in 3 weeks (15 working days), 3 sprints × 1 week
**Demo scale:** one school, 30 children, from a school-provided enrolment PDF
**Stack:** Convex (database, functions, scheduler, auth) · TypeScript · Next.js (App Router) · Africa's Talking (SMS + USSD)
**Rhythm:** pair-all-day — one vertical slice per day, demoable at end of day

---

## 1. Architecture in one page

One Convex deployment. It is the database, the function runtime, the scheduler, the HTTP
surface and the auth provider. There is no worker process, no migration tool, no connection
pool, and no second vendor holding identity.

```
school uploads enrolment PDF ──▶ parse ──▶ confirm screen ──▶ roster (30 children)
                                                                    │
NFC reader / simulator ──┐                                          │ nightly
supplier web form ───────┤                                          ▼
school confirm (OTC) ────┼──▶ httpAction /ingest ──▶ `events`   expectations list
wallet adapter ──────────┤     (HMAC device auth)   (append-only,      │
AT: USSD + DLR webhooks ─┘                        idempotent)          │
                                                       │               │
                                    ctx.scheduler.runAfter(0, rules.evaluate)
                                                       │               │
   crons.ts (demo: manual triggers too) ───────────────┤               │
   materialise expectations ◀───────────────────────────────────────────
   missed-meal sweep at cutoff                         ▼
   window + threshold rules              rules table (data, not code)
   forecast + reconciliation                          │
                                                      ▼
                                            notification policy layer
                                  (opt-out→quiet→dedupe→collapse→priority→cap)
                                                      │
                                      ┌───────────────┴───────────────┐
                                      ▼                               ▼
                             notifications table            `suppressed` + reason
                                      │                      (auditable, FR-502)
                                      ▼
                             action ──▶ Africa's Talking ──▶ SMS / USSD
                                      ▲                          │
                                      └──── DLR httpAction ──────┘

Next.js dashboards ──useQuery──▶ reactive queries (live, no polling)
                                 every function opens with requireRole(ctx, …)
```

**Load-bearing decisions**

| Decision | Why | Upgrade path when it breaks |
|---|---|---|
| `events` is append-only, immutable, versioned — the spine of the system | FR-401. Data modelling, not storage choice. | Add a warehouse sink as another consumer. The event model does not change (NFR-303). |
| Idempotency via unique index on client-generated `eventId`, checked inside the mutation | Convex mutations are serializable — concurrent duplicates conflict and retry rather than double-write. | None needed. |
| **No consumer poller.** Ingest mutation schedules `rules.evaluate` directly | `ctx.scheduler.runAfter(0, …)` is transactional with the write: event and evaluation commit together or not at all. Removes a whole subsystem. | Workpool component for bounded concurrency if evaluation backs up. |
| Cron-driven evaluation for the other four trigger classes | Absence, Window, Predictive and Reconciliation are not event-shaped. | None needed. |
| Rules are documents with a **JSON predicate DSL**, interpreted in TS | AD-04 (edit without deploy). No SQL stored, so no injection surface in a config table. | A rule builder UI over the same documents. |
| **PDF import is a one-time enrolment load behind a seam** | The list is a standing roster, not a daily sheet — so the expectations model (FR-106, FR-207) is untouched. Parser sits behind an interface. | Swap the reader for OCR, or a school-system API, without touching anything downstream. |
| **Parsed names go to a confirm screen before they become roster** | A PDF parse is a guess. A human confirming 30 names takes 20 seconds and makes the demo honest. | Bulk correction UI at real scale. |
| **All timings are settings, with manual "run now" triggers** | A real service day runs 05:00→overnight and cannot be shown in a meeting. Also the only sane way to test absence triggers. | None — this is how it should have been built anyway. |
| Batch jobs page with `.paginate()` and chain via the scheduler | Convex bounds a transaction to roughly 16k documents read / 8k written (verify current limits). | Chunk size is one constant. |
| Dashboard aggregates computed on read | At demo scale a day is a few hundred documents. Counters before you need them are the classic 3am regret. | Convex aggregate component once a view exceeds the read budget. **Known ceiling.** |
| **Convex Auth**, not Clerk | Identity lives in the same deployment as the data — one vendor to answer for under the DPA, not two. | Clerk/WorkOS if you need orgs, SSO or MFA administration. |
| Reactive `useQuery` for live views | SC-03 and SU-04 come free. No polling layer. | None needed. |
| Forecast = trailing consumption × day-of-week factor | ~20 lines. A model earns its place after a term of real data. | Replace the function behind `demand.forecast_published`. |

**Deliberately deferred** — each a stub with a named upgrade point: WhatsApp channel (SMS
fallback covers SU-02/SU-04), tap-pattern anomaly detection (GV-05), ML forecasting,
offline reader firmware, payment rails (out of scope in the doc itself).

---

## 2. Demo configuration

Two knobs, both settings rather than code:

| Setting | Real value | Demo value |
|---|---|---|
| Service window | 12:30 – 14:00 | 5 minutes from "start service" |
| Missed-meal cutoff | ~14:30 | 2 minutes after window close |
| Low-balance threshold / re-arm margin | KES 50 / KES 20 | tuned so 3–4 children cross during the demo |
| Stalled-service trigger | 30% behind expected rate | fires within the compressed window |
| Reconciliation | overnight | manual "run now" |

Plus admin buttons: **run expectations now**, **run sweep now**, **run reconciliation now**.
These exist for testing absence triggers regardless of the demo — they are not throwaway scaffolding.

### What the enrolment list needs to contain

30 names alone demos only the boring path. To make the interesting behaviour fire, the list needs:

- **Guardian phone numbers** — real handsets in the room, so texts visibly land. *A class attendance sheet does not carry these; I need them from you.*
- **2–3 guardians with more than one child** — otherwise message-merging (P-11) never triggers.
- **Wallet starting balances**, a few deliberately near zero — for low-balance and depletion warnings.
- **Tag IDs**, real or simulator-assigned.
- **An agreed set of children who will not tap** — these produce the missed-meal texts, the most persuasive moment in the demo.

Tell me who is meant to be interesting and I will shape the list around it.

### Demo script (available end of Week 1)

1. School uploads the enrolment PDF. Names appear, someone confirms them. Roster exists.
2. Expectations generated for today — the list of who *should* eat.
3. Children tap (real tags or simulator). Guardians' phones buzz within a minute.
4. Live count on screen climbs against expected.
5. Cutoff passes. Guardians of the children who never tapped get a text.
6. Point at the phones. That is the product.

---

## 3. Sprint 1 — the spine (Days 1–5)

**Goal:** a tap becomes an SMS, and a *missing* tap does too.
**Demo at Friday close:** the six-step script above, end to end.

| Day | Slice | Requirements closed |
|---|---|---|
| **D1** | `git init`; Next.js + Convex scaffold; `schema.ts` — schools, students, guardians, guardianLinks, tags, devices, academicCalendar, events, users, **settings**; seed the settings table with demo timings. **Convex Auth wired, roles on the user document** (school / supplier / county / admin + scope id) | FR-101, FR-102, FR-104, FR-801 |
| **D2** | **Enrolment import:** upload screen → text extraction from the digital PDF → parsed names on a confirm screen → roster of 30, with guardian numbers, tags and opening balances attached. Parser behind an interface. Then `httpAction /ingest` — batched, HMAC per-device auth, idempotent on `eventId`, records `occurredAt` + `recordedAt`, flags clock skew, emits `meal.duplicate_rejected` | FR-105, FR-106, FR-203, FR-204, FR-206, NFR-204, NFR-402, ST-04 |
| **D3** | Expectations: cron materialises one row per active child against the academic calendar, paged and chained; cutoff sweep emits `meal.missed`. **Manual trigger buttons for both** | FR-207, FR-208, FR-405, NFR-104 |
| **D4** | `rules` table + JSON predicate interpreter; ingest mutation schedules `rules.evaluate`; first two rules (`meal.tapped` → guardian SMS, `meal.missed` → guardian SMS); channel adapter with a console implementation and the Africa's Talking action behind the same interface | FR-401, FR-402, FR-403, P-01, P-02 |
| **D5** | Simulator: deterministic from a seed, posts a service day to `/ingest`, with configurable failure scenarios (device offline, batched taps, no-show cohort). DLR `httpAction`. **One live count screen** (served vs expected, reactive). **Wire and rehearse the demo.** | FR-804, FR-507, NFR-805, AD-02, SC-03 (partial) |

**Sprint 1 done when:** the demo script runs cold twice with the same seed and produces identical
events, and replaying a device queue changes no count (NFR-204).

---

## 4. Sprint 2 — policy, wallet, pull channel, supply chain (Days 6–10)

**Goal:** stop the system being a firehose, and close the dispatch→confirm→reconcile loop.
**Demo at Friday close:** the same day run naive, then through the policy layer, with the
volume reduction printed as a number; plus a dispatch reconciled against consumption.

| Day | Slice | Requirements closed |
|---|---|---|
| **D6** | Policy layer as one ordered pipeline: opt-out → quiet hours → dedupe → collapse → priority → per-recipient cap (rate-limiter component). Every drop writes `notification.suppressed` with a reason. Templates parameterised, versioned, EN + SW, GSM-7 segment check that **fails at authoring time**. Cost instrumentation per trigger type | FR-501, FR-502, FR-505, FR-506, P-06, P-10, NFR-603, NFR-605, NFR-701, NFR-705 |
| **D7** | Collapse implemented scheduler-native: candidate written with `collapseUntil`, scheduled flush composes everything pending for that recipient into one message. Weekly digest. **Assert ≥55% suppression against the naive per-tap baseline in a test** | FR-503, FR-504, P-05, P-11, NFR-602 |
| **D8** | Wallet adapter against a mock external payer; mirrored balances; threshold comparator **with hysteresis and re-arm margin**; burn rate → projected depletion date. Entitlement never blocks service | FR-301–FR-304, FR-406, P-03, P-04, ST-02 |
| **D9** | USSD `httpAction` for the Africa's Talking callback — single session: child status today, balance, last five meal days, per-type opt-out, MSISDN update with audit trail | FR-508, P-07, P-08, P-09, NFR-702, NFR-703, NFR-604 |
| **D10** | Supply chain: supplier dispatch declaration (web form); school confirmation by one-time code; `delivery.unconfirmed` sweep; forecast cron; **reconciliation as a paged cross-stream join** over school+date computing dispatched/confirmed/consumed + variance; payment file derived **only** from confirmed deliveries | FR-601–FR-606, FR-608, SU-01, SU-02, SU-03, SU-07, SC-01, SC-02 |

**Sprint 2 done when:** a dispatch with no school confirmation produces no payment-file line,
and a wallet oscillating at the threshold emits exactly one warning.

---

## 5. Sprint 3 — surfaces, integrity, hardening (Days 11–15)

**Goal:** every actor sees their own truth, and the NFRs are measured rather than asserted.
**Demo at Friday close:** the full pilot walkthrough, run cold on a fresh deployment.

| Day | Slice | Requirements closed |
|---|---|---|
| **D11** | School dashboard, building on D5's live count: tomorrow's forecast, delivery confirm/dispute, staff override with reason code, own override rate, roster corrections effective next day, reader-silent alert | SC-01 – SC-07, FR-205, FR-701 |
| **D12** | County dashboard: variance ranked by magnitude, override rate by school, variance-streak alerts, drill from any aggregate to its constituent events, CSV export, programme totals on one screen | GV-01 – GV-04, GV-06 – GV-08, FR-702 – FR-705 |
| **D13** | Supplier dashboard + intra-day monitor: dispatched/confirmed/consumed per school per day with variance, trailing forecast accuracy, `service.stalled` on run-rate deviation | SU-04, SU-05, SU-06, SU-08, FR-607 |
| **D14** | Admin console: rules CRUD without deploy, **dry-run replay as a paged action over historical events that sends nothing**, deliverability by failure reason, undeliverable-MSISDN work queue, device fleet health, spend per trigger type, trace a message to its originating event by correlation id | AD-01 – AD-07, FR-404, FR-803, NFR-802 |
| **D15** | Audit log; retention config; **NFR verification pass** — ingest→enqueue p95, sweep duration, idempotent replay, dashboard render on throttled 3G; pilot demo script. **Buffer lives here** — the ~1 day Convex saves is deliberately not re-spent | FR-802, NFR-101 – NFR-106, NFR-205, NFR-401 – NFR-406, NFR-501, NFR-505, NFR-803 |

**MVP done when** these run green on a cold deployment:
1. Enrolment PDF uploaded and confirmed → roster exists.
2. Simulate a service day → guardians receive tap and missed-meal SMS within the latency budget.
3. A guardian dials USSD and gets status, balance and history in one session.
4. A supplier declares a dispatch; the school confirms; reconciliation computes variance; the payment file contains exactly the confirmed lines.
5. A school running slow triggers `service.stalled` mid-window.
6. The county sees variance ranked, drills to the underlying events, and exports it.
7. An admin edits a rule, dry-runs it over last week, and sends nothing.

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Guardian phone numbers not available with the name list** | High | Blocks the entire demo | The list is only half the input. Chase numbers, tags and opening balances **before D2**. Demo runs on real handsets in the room. |
| **Data residency under DPA 2019** — children's PII leaves Kenya | Medium | Programme-level | **Downgraded on D1: the deployment provisioned to `eu-west-1`, not the US.** EU hosting puts this in adequacy-safeguard territory rather than a bare cross-border transfer, which is a materially easier ODPC conversation. Still not in-country. Demo runs on consenting adults' handsets, not live programme data. Confirm the transfer basis and whether EU is acceptable to the county before real guardian data. Decision point end of Week 2. |
| **USSD short code provisioning lead time** (weeks in KE) | High | Blocks P-07 demo | Apply **Day 1**, before any code. Build against the AT sandbox short code meanwhile. |
| **ODPC registration** before live guardian data (NFR-506) | High | Blocks pilot, not build | Start Day 1. Paperwork, not engineering. |
| **PDF has no usable text layer** after all | Medium | Half a day | Parser sits behind an interface. Fallback for 30 names is transcribing once — cheaper than building OCR. Verify the actual file on D1. |
| **Convex transaction limits** on sweeps and replay | Low at demo scale | Rework later | Nil at 30 children; batch jobs still written paged from D3 so the code survives past the demo. |
| **Metered cost at 350k students** — batch-heavy workload on per-operation pricing | Medium | Programme-level | Instrument per trigger type from D6 (NFR-605 wants this anyway). Extrapolate end of Sprint 2, while switching is still cheap. |
| **Aggregate-on-read ceiling** on county dashboards | Medium | Dashboard latency | Known ceiling, named above. Move to the aggregate component only when a view exceeds budget. |
| §9 open questions (cutoff, variance tolerance, dispute arbiter, payment file format) | High | Rework in Sprint 2–3 | All **configuration, not code**. Demo values ship as defaults; real answers land as document edits. |
| Reader hardware absent | Certain | Sprint 1 shape | Absorbed: simulator + PWA reader. `/ingest` is the seam. |
| 3 weeks for this breadth | — | Scope, not schedule | Cut list, in order: WhatsApp → anomaly detection → weekly digest → forecast accuracy view. Never cut: idempotency, suppression audit, RBAC. |

---

## 7. How we work each day

Pair-all-day. No standup ceremony, no ticket theatre.

- **Open:** I read yesterday's checkbox state, restate today's slice in two lines, you correct or confirm.
- **Build:** one vertical slice, end to end — event → storage → rule → surface. No horizontal layers left dangling overnight.
- **Every non-trivial slice leaves one runnable check** — the smallest test that fails if the logic breaks. Idempotency, suppression, money and RBAC paths always get one.
- **Close:** demo the slice against a seeded run, tick the box, append anything discovered to §8.

### Progress board

**Sprint 1**
- [x] D1 scaffold + schema + settings + Better Auth — typecheck clean, 10/10 tests, seed idempotent on live deployment
- [x] D2 enrolment PDF import + confirm screen + ingestion — typecheck, lint, build, 22/22 tests green
- [x] D3 expectations + missed-meal sweeper + manual triggers — typecheck, lint, build, 28/28 tests green
- [x] D4 rules table + predicate interpreter + first two rules — typecheck, lint, 35/35 tests green, rules seeded on live deployment
- [x] D5 simulator + DLR + live count screen + demo rehearsal — typecheck, lint, build, 44/44 tests green; rehearsed on live deployment: 32 expectations → 29 taps via /ingest (940 ms) → replay 29 duplicates → sweep 3 missed → 32 SMS via console channel → DLR flips to delivered

**Sprint 2**
- [x] D6 policy layer + templates + cost instrumentation — typecheck, lint, 63/63 tests green; deployed to dev (rules + notifications tables cleared and re-seeded for the schema change)
- [ ] D7 collapse/merge + digest + 55% assertion
- [ ] D8 wallet + hysteresis + depletion forecast
- [ ] D9 USSD
- [ ] D10 dispatch → confirm → reconcile → payment file

**Sprint 3**
- [ ] D11 school dashboard
- [ ] D12 county dashboard
- [ ] D13 supplier dashboard + stalled service
- [ ] D14 admin console + dry-run replay
- [ ] D15 audit, NFR verification, demo script, buffer

### Waiting on you

- [ ] Enrolment PDF (30 children, digital with text layer)
- [ ] Guardian phone numbers — real handsets, 2–3 guardians with multiple children
- [ ] Opening wallet balances, a few near zero
- [ ] Which children will not tap during the demo
- [ ] USSD short code application submitted
- [ ] ODPC registration started

## 8. Decisions and discoveries

_Appended as we go. Date, decision, why._

- **2026-09-09 — Convex over Postgres.** Chosen for day-1 velocity (no ops, no migrations, no
  worker process), per-function authorization as the natural home for NFR-404, and free
  reactivity on SC-03/SU-04. Accepted costs: paged batch jobs for four of the seven trigger
  classes, aggregate-on-read ceiling on dashboards, metered pricing against a batch-heavy
  workload, and the residency question above. Convex Auth over Clerk to keep identity and
  data with one vendor.
- **2026-09-09 — Demo shape.** One school, 30 children, from a school-provided **one-time
  enrolment PDF** (not a daily attendance sheet) — so the expectations model is unchanged:
  expectations are still generated nightly from the standing roster of active children, and a
  child absent from school still produces a missed-meal alert. PDF is digital with a text layer;
  parser sits behind an interface with hand-transcription as the fallback. Upload is part of the
  demo narrative, so the screen and parse must visibly work. All timings become settings with
  manual triggers — needed for testing absence triggers regardless of the demo.

- **2026-09-09 — Better Auth, not Convex Auth.** Reversal of the decision above, made on
  D1 after checking current docs. Convex's own documentation marks Convex Auth beta —
  "isn't complete and may change in backward-incompatible ways" — with Next.js support
  under active development. The official `@convex-dev/better-auth` component keeps auth
  data inside the Convex deployment via its adapter, which is the residency property
  Convex Auth was chosen for, without the beta risk, and ships a complete Next.js App
  Router guide. Clerk remains ruled out on residency. Versions pinned: convex 1.45.0,
  @convex-dev/better-auth 0.12.5, better-auth 1.6.30.
- **2026-09-09 — Event payload typing.** `events.payload` is a flat scalar record
  (`string | number | boolean`), not `any` — every payload in the catalogue is flat
  scalars, so this is truthful rather than permissive, keeps CLAUDE.md's no-`any` rule,
  and tolerates additive change per NFR-804. Per-event-type validators get added as each
  type is implemented, starting D2.
- **2026-09-09 — Role logic split from Convex.** Pure predicates live in
  `convex/lib/roles.ts` with zero framework imports; ctx-bound guards in
  `convex/lib/authz.ts`. FR-801 and NFR-404 are therefore testable without the harness,
  and the seven role/scope tests run in ~1s with no deployment.
- **2026-09-09 — Deployment region is `eu-west-1`.** Convex provisioned the dev deployment
  to EU West, not US East as assumed when the residency risk was written. Risk downgraded
  from High to Medium and the row rewritten. Verify the same region applies to the
  production deployment before the pilot.
- **2026-09-09 — Tests live in `tests/`, not `convex/`.** The Convex CLI typechecks
  everything under `convex/` against `convex/tsconfig.json`, which has no Vite types, so
  `import.meta.glob` in a colocated test breaks `convex dev`. Tests are not Convex
  functions and do not belong in the deployed directory.
- **2026-09-09 — D2: `pdf-parse@1.1.1`, not the current `2.x`.** `2.x` is a pdf.js
  rewrite that drags in `@napi-rs/canvas` for its rendering path; Convex's Node-action
  bundler fails analysing it (`DOMMatrix is not defined`) even though only text
  extraction is used. `1.1.1` has no canvas dependency. Its own `index.js` also runs a
  self-test against a bundled sample PDF whenever `module.parent` is falsy — true under
  Convex's bundler — so the action imports `pdf-parse/lib/pdf-parse.js` directly,
  skipping that entry point. No published types; a 4-line local `.d.ts` covers the one
  call made.
- **2026-09-09 — D2: `events` gets `studentId` + `serviceDate`, and a new `wallets`
  table.** FR-204/ST-04 need "does this student already have a `meal.tapped` today"
  answered cheaply; denormalising those two fields onto `events` (same pattern as the
  existing `schoolId`/`sourceDeviceRef`) and indexing `by_student_serviceDate_type`
  answers it in one indexed lookup instead of a new table. `wallets` (`studentId`,
  `balanceKes`) exists only to hold the opening balance D2's import captures — D8 owns
  the real adapter/hysteresis shape and extends this table rather than replacing it.
- **2026-09-09 — D2: self-serve signup always becomes a "school" user on the one seeded
  pilot school.** No invite or admin-assignment flow exists yet, and building one is out
  of scope for a single-school pilot. `convex/users.ts#bootstrapProfile` is marked
  `ponytail:` at the definition; replace it with real role assignment before D9 needs a
  county or supplier login.
- **2026-09-09 — D2 auth UI was unscoped work, built anyway.** D1 wired Better Auth's
  backend (component, config, role/scope guards) but no frontend ever called it — no
  ConvexProvider, no sign-in page existed. D2 needed an authenticated caller for
  `requireRole`, so this slice also adds `ConvexBetterAuthProvider` wiring, the
  `/api/auth/[...all]` route, and a plain email/password sign-in form.
- **2026-09-12 — D3: the sweep is scheduler-driven, not a cron.** `startSchoolDay`
  resolves the window from `serviceWindowMinutes` + `cutoffOffsetMinutes` and calls
  `ctx.scheduler.runAt(cutoffAt, sweepMissed)` in the same transaction that writes the
  first page of expectations — so the cutoff moves with the settings and there is no
  polling cron guessing when "cutoff" is. The only cron (`convex/crons.ts`) fires
  materialisation at 09:30 UTC (12:30 Nairobi, the real window start); the demo path is
  the same code behind "Run expectations now" at `/service-day`.
- **2026-09-12 — D3: materialisation pages with `.paginate()` + cursor, the sweep with
  `.take()` and no cursor.** Students don't change while being paged, so a cursor is
  needed; swept rows flip out of the `pending` index range, so re-taking the head is the
  next batch. Both chain via `runAfter(0, …)`. A tap that lands before materialisation
  still counts: `materialiseStudent` checks `by_student_serviceDate_type` for a
  `meal.tapped` and creates the row already `fulfilled`. A tap after the sweep leaves the
  row `missed` — the guardian has already been told.
- **2026-09-12 — D3: no calendar row = not a school day.** Materialisation only runs
  when `academicCalendar` says `isSchoolDay`; a missing row is treated as a holiday and
  reported as `not_school_day` rather than guessed. Seed the calendar before the demo.
- **2026-09-12 — D3: sign-in/profile gate extracted to `app/components/SchoolGate.tsx`.**
  The enrolment page still carries its inline copy because it has uncommitted parser WIP
  in the D2 worktree; swap it to `SchoolGate` when that lands.
- **2026-09-13 — D4: every event insert goes through `recordEvent` (`convex/lib/events.ts`).**
  It inserts the row and `runAfter(0, rules.evaluate, { eventId })` in the same transaction,
  so ingest, the sweeper and any future producer get rule evaluation without remembering
  to schedule it. Cost: one scheduled function per event, including ones no rule listens
  to (`meal.expectation_created`); acceptable at demo scale, gate on a `rules.by_eventType`
  probe if scheduling volume ever matters.
- **2026-09-13 — D4: predicate DSL is a JSON string validated by `parsePredicate`.**
  Convex validators cannot express a recursive type, so the rule row stores the predicate
  as `v.string()` and `convex/lib/predicate.ts` (pure, no framework imports) parses and
  shape-checks it before evaluation — a malformed rule evaluates to "no match", never to
  a thrown error inside the ingest path. Ops: `always`, `eq/ne/gt/gte/lt/lte` over flat
  payload fields, `and/or/not`. Fields resolve against `events.payload` only.
- **2026-09-13 — D4: notification idempotency by `dedupeKey` = `rule:eventId:guardian`.**
  Same pattern as `events.eventId`: re-running `rules.evaluate` for an event (dry-run,
  replay, scheduler retry) creates nothing. The policy pipeline (opt-out, quiet hours,
  collapse, cap) is deliberately absent — D6 slots in between "rule matched" and
  "notification inserted" in `notifyGuardians`.
- **2026-09-13 — D4: SMS channel is an adapter chosen by the `smsChannel` setting.**
  `convex/lib/channels/` holds `SmsChannel` (`send(message) → sent | failed`), a console
  implementation (logs masked MSISDN + length only — no message body, per no-PII logging)
  and Africa's Talking via `fetch` (no `"use node"`), env `AT_USERNAME` / `AT_API_KEY` /
  optional `AT_SENDER_ID`; username `sandbox` routes to the sandbox host. The `deliver`
  action is the single exit point; it reads the notification, sends, and records
  `sent`/`failed` + provider id. DLR webhook is D5.
- **2026-09-13 — D4: `/service-day` takes a date picker.** Materialisation is gated on the
  calendar, and the demo was built on a Sunday; picking any seeded weekday is the honest
  fix — the seed still marks weekends as holidays (P-02) rather than faking school days.
- **2026-09-13 — D4: Celcom Africa is the SMS provider; Africa's Talking stays as a second
  adapter.** Ported from an existing OTP service: JSON POST to `CELCOM_URL` with
  `apikey`, `partnerID`, `shortcode`, optional `pass_type`, `mobile`, `message`; success
  is HTTP 200 and (when present) `responses[0]["respose-code"] === 200` — the gateway's
  own misspelling, so both spellings are read. Set the `smsChannel` setting to `celcom`
  after `npx convex env set CELCOM_URL/CELCOM_API_KEY/CELCOM_PARTNER_ID/CELCOM_SHORTCODE`.
- **2026-09-13 — D5: the simulator is a Convex action that posts to its own `/ingest`.**
  `simulator.runServiceDay` provisions one `SIM-READER-01:<school>` device per school (secret
  derived server-side, never typed), plans the day with `lib/simulation.ts` (pure, mulberry32
  PRNG, event ids `sim:<seed>:<date>:<tag>`), and HMAC-signs each batch exactly as hardware
  would — so the demo exercises the real trust boundary and replaying a seed is idempotent
  (NFR-805, NFR-204). Scenarios are two numbers: `noShowCount` (absence cohort) and
  `batchSize` (1 = live reader, roster-sized = offline reader flushing). Taps for a day
  other than today are stamped inside that day's real window so ingest files them under
  the picked date; they arrive clock-skew flagged, which is truthful.
- **2026-09-13 — D5: DLR is `POST /dlr?token=<DLR_TOKEN>`.** Gateways don't sign callbacks;
  a shared token in the URL is the gate. `lib/deliveryReport.ts` accepts JSON or form bodies
  and several id/status spellings because the Celcom DLR field names are unconfirmed
  (TODO in that file). A report for an unknown provider id is a 200 `matched:false`, not an
  error. Matched reports flip the notification to `delivered`/`failed` and append
  `notification.delivered`/`notification.failed` events through `recordEvent`.
- **2026-09-13 — D5: the live count screen is `/service-day`, not a new page.** It already
  had the reactive summary; it now leads with `served / expected`, carries the simulator
  controls, and lists recent notifications. Demo order on that page: pick a seeded weekday
  → Run expectations → Simulate taps → Run sweep. D11 grows this into the school dashboard.
- **2026-09-13 — CLI rehearsal as a signed-in user:** `npx convex run <fn> --identity
  '{"subject":"<authUserId>","sessionId":"<betterAuth session _id>"}'` — the Better Auth
  component resolves the user through the session, so `subject` alone is not enough.
- **2026-09-14 — PWA phone reader at `/reader`.** A read-only NFC tag is only a UID; the
  phone is the reader. Chrome-on-Android Web NFC (`NDEFReader.serialNumber`) → signed
  batch to the existing `/ingest`, no server contract change. The phone provisions
  itself (`readers.provision`, school-scoped, secret minted server-side like the
  simulator) and keeps `{deviceRef, signingKeyHex}` plus an offline tap queue in
  `localStorage`; `eventId = deviceRef:tagUid:occurredAt` so a flush after airplane
  mode is replay-safe. **Tag UID canonical form is `normaliseTagUid` (trim +
  lowercase)** applied at ingest lookup, enrolment insert and `readers.assignTag` —
  Web NFC reports lowercase colon-hex, PDFs may not. Reassigning a UID deletes the
  previous holder's row (the `by_tagUid` lookup is `.unique()`); the events table is
  the audit trail. No service worker: the page needs network to load and the queue
  covers mid-service dropouts. Dev on a LAN IP is not a secure context — the Chrome
  flag `unsafely-treat-insecure-origin-as-secure` for `http://<laptop-ip>:3000` is the
  workaround, a `cloudflared` tunnel the fallback. Web NFC is Chrome/Android only;
  the page falls back to a typed UID field for USB readers.
- **2026-09-14 — `tests/expectations.test.ts` was a time bomb.** It hardcoded
  `SCHOOL_DAY = 2026-09-14`; `startServiceDay` schedules the sweep with `runAt(cutoffAt)`
  and convex-test fires past-due schedules immediately, so from ~09:37Z that day the
  sweep ran before the tap under test. School day is now `today + 7`.
- **2026-09-14 — Three things a browser reader needs that the simulator never did.**
  (1) Next dev blocks its own assets for any origin but `localhost` — `allowedDevOrigins`
  in `next.config.ts` lists private LAN ranges, otherwise the page never hydrates and the
  auth gate spins forever. (2) Better Auth rejects sign-in from origins other than
  `SITE_URL` — `TRUSTED_ORIGINS` (comma-separated env) is spread into `trustedOrigins`;
  set it to the laptop's LAN origin whenever the Wi-Fi changes. (3) `/ingest` is called
  cross-origin with custom headers, so it needs an `OPTIONS` route and CORS headers on
  every response; `Allow-Origin: *` is fine because the endpoint is HMAC-authenticated
  and cookie-free. Verified live: 13 phone taps → 1 accepted, 12 `second_tap_same_day`.
- **2026-09-15 — Celcom is live on the dev deployment.** `settings.set` (internal) flips
  `smsChannel` to `celcom` without a redeploy; the adapter strips a leading `+` because the
  gateway wants bare `254…`. Celcom's DLR posts `{ messageid, description, timeTaken,
  timestamp }` with the state in `description` (e.g. `DeliveredToTerminal`), so
  `description` is now a status key as well as a reason key. `notifications.sendTest`
  (internal) inserts a real `notification.test` event + queued notification and runs it
  through `channels.deliver` and `/dlr` — the smoke test uses the production path, not a
  side door. Guardians now carry `displayName` from the roster (`guardianName` column) so
  templates can say `Dear {{guardian}}`; `seedRules` patches an existing rule's template
  when the seed text changes. `seed.resetPilotRoster` wipes roster-derived tables and
  loads five real pilot families (Grade 6B, KES 100 opening balance) for handset testing.
- **2026-09-15 — D6: the policy layer is one pure function.** `lib/policy.ts` →
  `applyPolicy(input) → send | defer | suppress(reason)`; `rules.notifyGuardians` gathers
  the inputs (guardian opt-outs, settings, today's count) and acts on the verdict. Order
  follows FR-501 with two honest deviations: dedupe runs *first* as the idempotent replay
  guard (a suppressed row carries the same `dedupeKey`, so a replay of an opted-out event
  writes nothing twice), and the cap is checked before deferral (a deferred message still
  counts against today, so "at cap during quiet hours" is `daily_cap`, not a 06:00 send).
  Collapse and priority ranking are D7 — they need the scheduled flush to have anything
  to rank. Quiet hours *defer* rather than drop: `deliverAt` on the row and
  `scheduler.runAt` instead of `runAfter(0)`. All hours are Nairobi (UTC+3, no DST;
  `lib/dates.ts` helpers). Suppressed messages are notification rows with
  `status: suppressed` + `suppressionReason`, plus a `notification.suppressed` event
  (FR-502). Cap is a per-guardian index scan over today's rows (`by_guardian` +
  `_creationTime`), not the rate-limiter component — ceiling noted in code.
- **2026-09-15 — D6: templates are `{ en, sw }` with a `templateVersion`.** The guardian's
  `language` picks the text; the notification row records the version it was rendered
  from. `assertSingleSegment` renders each template at worst-case widths (24-char names,
  30-char school) and counts GSM-7 segments (`lib/gsm7.ts`: basic set 1, extended set 2,
  any other char → UCS-2/70); `seedRules` throws before insert and `tests/gsm7.test.ts`
  asserts every demo template — so an over-long template fails at typecheck/test time,
  not on a guardian's phone. Spend is computed on read: `notifications.spendByRuleToday`
  sums `segments × smsCostPerSegmentKes` (new setting, KES 0.80) per `ruleKey` for
  sent/delivered rows and counts suppressed alongside, shown on `/service-day`. Schema
  change required clearing `rules` and `notifications` on dev (rehearsal data only).

