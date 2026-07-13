# Ikigaro Health

Ikigaro's health-tracking web app. Built with Next.js (App Router), deployed to
Cloudflare Workers via the [OpenNext](https://opennext.js.org/cloudflare)
adapter, using Supabase for database/storage and Privy for authentication.

This is a separate app from the ikigaro.com marketing site — it is served from
`app.ikigaro.com`.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in the values (see below)
npm run dev                         # http://localhost:3000
```

## Environment variables

Set these in `.env.local` for local development, and in the Cloudflare Worker
settings for production. `.env.local` is gitignored and must never be committed.

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | client + build | Privy app id (public). Initializes the Privy provider. |
| `PRIVY_APP_SECRET` | server (secret) | Privy app secret. Reserved for future server-side Privy calls. |
| `NEXT_PUBLIC_SUPABASE_URL` | client | Supabase project URL (public). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | Supabase anon key (public; RLS enforced). |
| `SUPABASE_SERVICE_ROLE_KEY` | server (secret) | Supabase service-role key. Server-only; bypasses RLS. |

Notes:
- On Cloudflare, `NEXT_PUBLIC_*` values must be set as **build** variables —
  Next.js inlines them at build time. Server-only secrets are **runtime**
  variables. The Supabase URL used by server code is a committed constant
  (`src/lib/supabase-admin.ts`, overridable via `SUPABASE_URL`) so it does not
  depend on build-time inlining.
- The Privy token verification key is public and committed in
  `src/lib/privy-verification-key.ts` (overridable via `PRIVY_VERIFICATION_KEY`).

## Architecture

- **Auth:** Privy handles login (email OTP). After login the client posts the
  Privy access token to `POST /api/auth/sync`, which verifies it locally with
  the Web Crypto API (`src/lib/verify-privy-token.ts`) and upserts the user into
  Supabase. Verification uses `crypto.subtle` directly rather than a library,
  because `jose` / `@privy-io/server-auth` bundle to a `node:crypto` build that
  does not run on Cloudflare Workers.
- **Database:** Supabase Postgres. Schema lives in `supabase/migrations/`. Every
  table has Row Level Security enabled with no public policies — all access goes
  through the server using the service-role key.
- **Hosting:** Cloudflare Workers via OpenNext, wired to this repo's `main`
  branch (see `wrangler.jsonc` / `open-next.config.ts`).

## Scripts

```bash
npm run dev          # local dev server
npm run build        # next build
npm run lint         # eslint
npm run cf:preview   # build + run the worker locally in workerd
npm run cf:deploy    # build + deploy to Cloudflare
node --env-file=.env.local scripts/test-supabase.mjs   # verify Supabase connectivity
```

## Database migrations

Apply `supabase/migrations/*.sql` via the Supabase SQL editor (or the Supabase
CLI) in filename order:

- `0001_init_core_schema.sql` — core identity: `users`, `profiles`,
  `connections`, `events`.
- `0002_product_schema.sql` — Phase 0 product model: biomarker panels &
  readings, the marker catalog (taxonomy + reference ranges), daily check-ins,
  the iki-points economy (balance + append-only ledger), the redemption
  marketplace, and "Future You" predictions. `healthkit_syncs` is defined but
  unused until the Phase 2 native app.

Every table keeps the same auth posture: RLS enabled, no policies, all access
via the service-role key.

> **Clinical safety:** the reference ranges seeded into `biomarker_catalog` are
> common, unvalidated adult intervals used only to bootstrap the schema (every
> row is flagged `is_validated = false`). They must be reviewed and signed off
> by a qualified professional — and localized per partner lab — before any
> production use.
