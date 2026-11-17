# Deploy Mlo to mlo.2003.studio

The Next.js frontend runs on **Cloudflare Workers with OpenNext**. Convex continues
to host the database, authentication, file storage, HTTP callbacks and scheduled
jobs. Use Node 24 LTS and the pinned pnpm version in `package.json`.

## 1. Prepare the production backend

Select this project's production deployment in the Convex dashboard. Production
has separate data, users, settings, reader credentials and environment variables;
deploying code does not copy development data. Do not run the demo seed against
real programme data.

Set these **in the production Convex deployment**, before deploying the backend:

```sh
pnpm exec convex env set --prod SITE_URL https://mlo.2003.studio
pnpm exec convex env set --prod BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
```

Generate the auth secret only for a new deployment; preserve an existing production
secret. `SITE_URL` trusts the Mlo origin automatically. `TRUSTED_ORIGINS` is needed
only for additional intentional frontend origins; preserve existing values when
changing it. Keep localhost and the development tunnel on the development backend.

Configure the production integrations you use in Convex: `USSD_TOKEN`, `DLR_TOKEN`,
Africa's Talking or Celcom credentials, and `GROQ_API_KEY` for AI delivery photo
assessment. The SMS channel defaults to console logging; configure the real channel
and programme settings before live use. AI receipt review needs a valid Groq key.
Keep all these secrets out of Cloudflare build variables and `NEXT_PUBLIC_*` values.

Deploy the backend from the project root:

```sh
pnpm install --frozen-lockfile
pnpm exec convex deploy
```

Confirm the selected production target when prompted. Provision programme settings,
schools, users, roles and devices in that deployment. In the Convex dashboard, copy
its deployment URL and HTTP actions URL; regional hostnames must be copied exactly.
Provider callbacks (`/ussd/<token>`, `/dlr?token=…`) stay on the **Convex HTTP actions
domain**, not `mlo.2003.studio`; update providers if moving from development.

## 2. Configure Cloudflare

The `2003.studio` zone must be active in the Cloudflare account deploying the Worker.
`wrangler.jsonc` declares `mlo.2003.studio` as a Worker Custom Domain; deployment
creates its DNS record and certificate. If that exact hostname already has a DNS
record or tunnel route, remove that conflicting entry before attaching the domain.
Leave the separate `dishi.2003.studio` development tunnel alone.

Create a Worker named **mlo** (or connect the repository through Workers Builds).
Set both variables below in **Settings → Variables and Secrets** for runtime,
and in **Settings → Build → Variables and secrets** when using Workers Builds:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Production Convex deployment URL (`https://…convex.cloud`) |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Matching production HTTP actions URL (`https://…convex.site`) |

Both URLs must identify the same backend. Public variables are compiled into the
browser bundle: changing them requires a rebuild. `keep_vars` preserves dashboard
runtime variables on CLI deployments. Do not upload `.env.local` or set
`CONVEX_DEPLOYMENT` in Cloudflare.

For Workers Builds use root directory `/`, build command `pnpm build:cloudflare`,
deploy command `pnpm deploy:cloudflare`, and Node version **24** (`NODE_VERSION=24`
in build variables). Disable non-production branch auto-deployments until separate
preview Workers and backends are configured; this configuration owns the live domain.
Deploy Convex first whenever backend code changes.

## 3. Build, preview and deploy

For a local production build, export the two production URLs in the shell, overriding
the development values in `.env.local`. `.env.example` lists the required names.
Then run:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build:cloudflare
pnpm preview:cloudflare
```

The preview uses the Workers runtime at `http://localhost:8787`. Public pages can
be smoke-tested there; validate secure-cookie authentication on the final HTTPS
domain. Stop the preview with Ctrl-C. To publish the build you just checked:

```sh
pnpm exec wrangler login
pnpm deploy:cloudflare
```

`deploy:cloudflare` uploads the existing build; rebuild after every code or public
environment change. No tunnel or local server is needed after deployment. No R2,
D1 or KV binding is required: the app renders dynamically and stores data in Convex.

## 4. Verify the live app

- Open `https://mlo.2003.studio/` and `/login`; sign in, reload, and sign out.
- Check each provisioned role's workspace and confirm access restrictions.
- Verify roster import, deliveries, photo upload/read and AI assessment with test data.
- Check SMS/USSD callbacks against the production Convex HTTP actions URL.
- On Android, sync queued taps on the old reader origin **before** switching.
  Open `https://mlo.2003.studio/reader`, sign in, provision the reader again, and
  test a physical NFC scan and offline queue/sync. Browser storage is per origin;
  neither pending taps nor device credentials migrate to the new domain.

Useful diagnostics: `pnpm exec wrangler tail`, the Convex logs, and
`curl -sS -I https://mlo.2003.studio`. Restore a prior Worker version through
Cloudflare Deployments if needed; this does not roll back Convex schema or data.

References: [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/),
[OpenNext setup](https://opennext.js.org/cloudflare/get-started),
[build and runtime variables](https://opennext.js.org/cloudflare/howtos/env-vars).
