# Dishi

Dishi handles communication and reconciliation for school feeding in Nairobi primary schools.

Food already moves: the county funds a supplier, the supplier cooks and delivers, and each
student taps an NFC tag to collect a KES 5 meal. What's missing is information. Guardians
don't know whether their child ate, suppliers guess how much to cook, and the county only
sees totals after it's too late to act. Dishi records each meal as an event and sends that
information to the people who need it.

## Features

- **Guardian SMS and USSD:** meal served, meal missed, low balance and a weekly digest,
  with opt-out, quiet hours, dedupe, collapse and a daily cap.
- **Service day:** NFC reader (or simulator), manual overrides and reader health checks.
- **Supply chain:** tomorrow's portion forecast, dispatch declaration, school confirmation,
  and reconciliation of portions dispatched against portions eaten.
- **Dashboards:** separate views for school, supplier, county and admin. Each view puts
  exceptions first and updates live.
- **Rules engine:** rules are stored as JSON predicates, so they can be changed without a
  deploy. Admins can replay a rule against past events before turning it on.
- **Hardening:** audit log, retention purge, delivery retries, device revocation and NFR
  metrics.

## Stack

| Layer | Choice |
|---|---|
| Backend | [Convex](https://convex.dev): database, functions, scheduler, HTTP and crons |
| Frontend | Next.js 16 (App Router), React 19, Tailwind 4 |
| Auth | Better Auth via `@convex-dev/better-auth` |
| SMS / USSD | Adapters for `console`, `celcom` and `africastalking` |
| Tests | Vitest with `convex-test` |

## Architecture

```
NFC reader / simulator ─┐
supplier form ──────────┤                              ┌─▶ notification policy ─▶ SMS adapter
school confirmation ────┼─▶ POST /ingest ─▶ events ─▶ rules.evaluate
wallet payments ────────┘   (HMAC auth,   (append-only, └─▶ suppressed (logged with reason)
                             idempotent)
crons ─▶ expectations · missed-meal sweep · forecasts · reconciliation · digest · retention
Next.js dashboards ─▶ reactive queries (every function checks role)
```

- `events` is append-only. Each `eventId` is unique, so a retried request can't record the
  same event twice.
- Ingest schedules rule evaluation in the same transaction as the write, so no poller is
  needed.
- Every timing (service window, cutoff, caps, thresholds) is stored as a setting and can be
  changed at runtime. To see the full list, look at `DEMO_SETTINGS` in `convex/settings.ts`.

For the full design and its tradeoffs, see [`PLAN.md`](PLAN.md). For requirements and the
event catalogue, see
[`School Feeding Platform — Event Catalogue & Requirements.md`](School%20Feeding%20Platform%20—%20Event%20Catalogue%20&%20Requirements.md).

## Getting started

**Prerequisites:** Node 20+, pnpm 11 and a Convex account.

```bash
pnpm install
pnpm dev:convex                       # creates the deployment and writes .env.local
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set SITE_URL http://localhost:3000
npx convex run seed:seedDemo          # pilot school NRB-PILOT-01, settings, rules
pnpm dev                              # in a second terminal: http://localhost:3000
```

New accounts start with the `school` role. To give an account the `supplier`, `county` or
`admin` role:

```bash
npx convex run users:assignRole '{"userId":"<users _id>","role":"admin"}'
```

## Configuration

Set Convex environment variables with `npx convex env set KEY value`. Don't commit any of
them.

| Variable | Needed for |
|---|---|
| `BETTER_AUTH_SECRET`, `SITE_URL` | Auth |
| `TRUSTED_ORIGINS` | Extra origins, comma-separated (for example, a LAN IP for phone testing) |
| `USSD_TOKEN` | USSD callback path `/ussd/<token>` |
| `DLR_TOKEN` | Delivery-report webhook `/dlr` |
| `PAYMENT_TOKEN` | Wallet top-up events |
| `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` | Africa's Talking channel |
| `CELCOM_URL`, `CELCOM_API_KEY`, `CELCOM_PARTNER_ID`, `CELCOM_SHORTCODE`, `CELCOM_PASS_TYPE` | Celcom channel |

To switch the SMS channel at runtime (the default is `console`, which only logs):

```bash
npx convex run settings:set '{"key":"smsChannel","value":"celcom"}'
```

## Project structure

```
app/            Next.js routes: service-day, reader, enrolment, deliveries,
                supplier, county, admin
convex/         Queries, mutations, actions, HTTP routes (http.ts), crons (crons.ts)
convex/lib/     Framework-free logic: predicate DSL, policy, channels, USSD, GSM-7, HMAC
tests/          Vitest suites, one per feature area
```

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` / `pnpm dev:convex` | Next.js dev server / Convex dev sync |
| `pnpm test` | Run the test suite once |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` | Production build |

## Privacy

The platform handles data about children. Phone numbers and names are masked before
they're logged (`convex/lib/mask.ts`), and a scheduled job purges old data according to
the `retention*` settings.

## Contributing

Branch from `main` as `feature/<name>` or `fix/<name>`. Before opening a PR, make sure
`pnpm typecheck && pnpm test && pnpm lint` passes.
