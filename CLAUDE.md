# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

**Before touching anything in `convex/`, read `convex/_generated/ai/guidelines.md` first.** It overrides training-data assumptions about Convex APIs.

**Read `PLAN.md` before starting any new slice.** It is the living build plan (3 sprints × 5 days) with a progress checklist (§7) and a decisions log (§8) — architectural calls (e.g. Better Auth over Convex Auth, event payload typing, EU region, why tests live outside `convex/`) are recorded there with rationale, not repeated here. Update §8 when you make or reverse a decision; tick §7 when a day's slice is demoed.

## Commands

```bash
pnpm dev              # next dev (web) — run alongside `pnpm dev:convex`
pnpm dev:convex       # convex dev (backend, schema push, codegen)
pnpm build            # next build
pnpm lint             # eslint
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run (all tests, once)
pnpm test:watch       # vitest (watch mode)
pnpm vitest run tests/roles.test.ts   # single test file
pnpm vitest run -t "rejects a role absent from the allow list"  # single test by name
```

There is no separate backend server to start — Convex is the entire backend (db, functions, scheduler, HTTP, auth). Running the app requires both `dev` and `dev:convex` concurrently.

## Architecture

**One Convex deployment is the whole backend.** No Postgres, no worker process, no separate auth vendor — see PLAN.md §1 for the full diagram and the "load-bearing decisions" table explaining each choice and its upgrade path.

**Event-sourced core.** `events` (convex/schema.ts) is an append-only, immutable table — the spine everything else derives from. Idempotency comes from a unique index on client-generated `eventId`, enforced inside the mutation (Convex mutations are serializable, so concurrent duplicates conflict and retry rather than double-write). `payload` is a flat scalar record (`string | number | boolean`), never `any` — every event type in the catalogue is flat scalars.

**No consumer poller.** Ingest mutations call `ctx.scheduler.runAfter(0, ...)` directly so the write and the scheduled evaluation commit atomically. The four trigger classes that aren't event-shaped (absence, window, predictive, reconciliation) are cron-driven instead.

**Settings are data, not constants.** `convex/settings.ts` defines every tunable (service window, cutoff, thresholds, quiet hours, caps) as a row in the `settings` table with a typed `SettingKey` map and `readSetting(ctx, key)` helper. Never hardcode a timing or threshold that appears in `DEMO_SETTINGS` — add/read a setting instead.

**Authorization is split into two layers** (`convex/lib/`):
- `roles.ts` — pure predicates (`isRoleAllowed`, `isInSchoolScope`), zero framework imports, unit-testable with no deployment.
- `authz.ts` — ctx-bound guards (`requireUser`, `requireRole`, `requireSchoolScope`) that layer auth lookup and role checks on top. Every query/mutation that touches non-public data should open with one of these.

Roles are `school | supplier | county | admin` (`convex/schema.ts`); only `school` is school-scoped (`SCHOOL_SCOPED_ROLES` in `roles.ts`) — other roles pass scope checks unconditionally.

**Auth is Better Auth**, not Convex Auth (reversed on D1 — Convex Auth is beta; see PLAN.md §8 for why). Wired via `@convex-dev/better-auth`: `convex/auth.ts` creates the client/component and `createAuth`, `convex/auth.config.ts` supplies the provider. `authComponent.safeGetAuthUser(ctx)` resolves the authenticated identity; app-level profile lives in the `users` table keyed by `authUserId`.

**Tests live in `tests/`, not `convex/`.** The Convex CLI typechecks everything under `convex/` against `convex/tsconfig.json`, which has no Vite types — a colocated test using `import.meta.glob`-style tooling breaks `convex dev`. Tests run under vitest with `environment: "edge-runtime"` and the `convex-test` package for mocking the deployment (see `vitest.config.mts`).

**Domain reference:** `School Feeding Platform — Event Catalogue & Requirements.md` is the source-of-truth requirements doc (FR-/NFR-/GV-/SU-/SC-/AD-/P- numbered requirements referenced throughout PLAN.md and commit messages).
