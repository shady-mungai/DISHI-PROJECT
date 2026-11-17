# Mlo: An Intelligent School Feeding Management and Communication System

The current academic report is [Mlo_Project_Report.docx](docs/Mlo_Project_Report.docx).
The [presentation rehearsal pack](docs/PRESENTATION_PREP.md) uses the same title.

Mlo handles communication and reconciliation for school feeding in Nairobi primary schools.

Food already moves: the county funds a supplier, the supplier cooks and delivers, and each
student taps an NFC tag to collect a KES 5 meal. What's missing is information. Guardians
don't know whether their child ate, suppliers guess how much to cook, and the county only
sees totals after it's too late to act. Mlo records each meal as an event and sends that
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

**Prerequisites:** Node 24 LTS, pnpm 11 and a Convex account.

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

For production at **https://mlo.2003.studio**, follow the
[Cloudflare Workers deployment guide](docs/cloudflare-deployment.md).

Set Convex environment variables with `npx convex env set KEY value`. Don't commit any of
them.

| Variable | Needed for |
|---|---|
| `BETTER_AUTH_SECRET`, `SITE_URL` | Auth |
| `TRUSTED_ORIGINS` | Extra origins, comma-separated (include `https://dishi.2003.studio` for the phone reader tunnel) |
| `USSD_TOKEN` | USSD callback path `/ussd/<token>` |
| `DLR_TOKEN` | Delivery-report webhook `/dlr` |
| `PAYMENT_TOKEN` | Wallet top-up events |
| `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` | Africa's Talking channel |
| `CELCOM_URL`, `CELCOM_API_KEY`, `CELCOM_PARTNER_ID`, `CELCOM_SHORTCODE`, `CELCOM_PASS_TYPE` | Celcom channel |

### Phone reader development

The fixed reader address is `https://dishi.2003.studio/reader`. The Cloudflare
tunnel's service URL is `http://localhost:3000` when `cloudflared` runs on the
same machine as `pnpm dev`. Cloudflare supplies HTTPS for the phone; the local
Next.js development server uses HTTP. Keep the server and tunnel connector running.

`next.config.ts` allows the tunnel hostname. In the development Convex deployment,
`TRUSTED_ORIGINS` must include `https://dishi.2003.studio` alongside any existing
origins. Chrome on an NFC-capable Android phone can then use the reader without
the insecure-origin flag.

Reader credentials and pending taps are stored per origin. Before moving from a
LAN URL, sync any pending taps there; sign in and provision the reader once at
the fixed address. The new address cannot access the old origin's queue.

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
