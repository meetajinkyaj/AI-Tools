# Ikigaro

The Ikigaro health app — lab-report understanding, daily check-ins, and an
iki-points reward economy. Live at **app.ikigaro.com** (private beta), with the
admin console at **admin.ikigaro.com**.

> **New to this codebase?** Read [`docs/HANDOVER.md`](./docs/HANDOVER.md) first —
> it's the orientation guide, and it links everything else in the right order.

Built with Next.js 16 (App Router), deployed to Cloudflare Workers via
[OpenNext](https://opennext.js.org/cloudflare), on Supabase Postgres with Privy
email-OTP auth. The marketing site (`www.ikigaro.com`) is a separate repo,
`meetajinkyaj/ikigaro-os`.

> ⚠️ **This is Next.js 16**, which differs from most documentation and training
> data — `middleware` is renamed `proxy`, among other breaking changes. Read
> `node_modules/next/dist/docs/` before writing App Router code. See
> [`AGENTS.md`](./AGENTS.md).

---

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in the values (see below)
npm run dev                        # http://localhost:3000
```

## Scripts

```bash
npm run dev          # local dev server
npm run build        # next build
npm run lint         # eslint
npm test             # vitest unit tests (162)
npm run e2e          # playwright end-to-end, against a local build
npm run e2e:staging  # playwright against the deployed staging app (what CI runs)

npm run cf:build     # OpenNext/Workers build — catches Workers-only failures
npm run cf:preview   # build + run the worker locally in workerd
npm run cf:deploy    # build + deploy to Cloudflare (CI does this; rarely manual)

# staging (CI deploys this from every PR; manual form shown for reference)
NEXT_PUBLIC_APP_ENV=staging npm run cf:deploy:staging

node --env-file=.env.local scripts/test-supabase.mjs   # check Supabase connectivity
```

**Before merging anything**, all five must pass:

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build && npm run cf:build
```

`cf:build` is not redundant — code can build under Next and still fail on
Workers (typically by reaching for a Node runtime API).

## Environment variables

Set in `.env.local` for development. In production these live in three separate
stores — see [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) §3, which explains which one
each value belongs in and why putting it in the wrong one breaks things.

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | client + build | Privy app id (public) |
| `PRIVY_APP_SECRET` | server (secret) | Privy app secret |
| `NEXT_PUBLIC_SUPABASE_URL` | client | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | Supabase anon key (public; RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | server (secret) | Bypasses RLS — server-only, never client |
| `ANTHROPIC_API_KEY` | server (secret) | Lab-report extraction |
| `CRON_SECRET` | server (secret) | Authenticates the reminders cron caller |

**Why some public values are hardcoded:** `NEXT_PUBLIC_*` variables are inlined
at build time, and a missing one in CI ships a white screen (this happened). The
Supabase URL, Privy app ID, and VAPID public key therefore have committed
defaults in `src/lib/` — each is a public value, and each is env-overridable.
This is deliberate.

---

## Architecture

**Auth.** Privy handles email-OTP login. The client posts its Privy token to
`POST /api/auth/sync`, which verifies it locally with the Web Crypto API
(`src/lib/verify-privy-token.ts`) and upserts the user. Verification is
hand-rolled with `crypto.subtle` rather than using `jose` or
`@privy-io/server-auth`, because those bundle a `node:crypto` build that does
not run on Cloudflare Workers.

**Beta gate.** New signups land waitlisted. `resolveApprovedUserId`
(`src/lib/app-user.ts`) is the single choke point — a waitlisted user resolves to
no user at every data route, so they can't read or write anything until an admin
approves them.

**Database.** Supabase Postgres; schema in `supabase/migrations/`. Every table
has RLS enabled with **no policies** — all access goes through the server with
the service-role key.

**Extraction.** The model transcribes numbers off the lab PDF onto a ~83-marker
catalog; `src/lib/biomarkers.ts` then deterministically recomputes every flag,
band, and derived marker. **The model never decides clinical meaning.** The user
confirms extracted values before anything is saved — that human step is the
accuracy guard.

**Hosting.** Cloudflare Workers via OpenNext (`wrangler.jsonc`,
`open-next.config.ts`). Push to `main` → CI lints, typechecks, tests, builds, and
deploys.

### Key files

| Area | File |
|---|---|
| Interpretation engine (flags, bands, units, derived markers) | `src/lib/biomarkers.ts` |
| Points economy — the only place values live | `src/lib/points.ts` |
| Extraction prompt + Anthropic client | `src/lib/extraction.ts`, `src/lib/anthropic.ts` |
| Beta gate / admin auth | `src/lib/app-user.ts`, `src/lib/admin-auth.ts` |
| Trends · Future You · analytics · reminders · referrals | `src/lib/trends.ts`, `future.ts`, `analytics.ts`, `reminders.ts`, `referral.ts` |
| Panel save (dedup + awards) / extract | `src/app/api/biomarkers/route.ts`, `.../extract/route.ts` |
| Reminder cron endpoint / push sender | `src/app/api/cron/due-reminders/route.ts`, `scripts/send-reminders.mjs` |
| Main UIs | `src/app/biomarker-report.tsx`, `trends-view.tsx`, `future-view.tsx`, `partners-view.tsx`, `admin-view.tsx` |

A fuller map is in [`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md) §6.

---

## Database migrations

Apply `supabase/migrations/*.sql` in filename order via the Supabase SQL editor
or CLI. All are idempotent — safe to re-run.

| Migration | What it adds |
|---|---|
| `0001_init_core_schema` | Core identity: `users`, `profiles`, `connections`, `events` |
| `0002_product_schema` | Biomarker panels/readings, marker catalog, check-ins, points ledger, redemptions, predictions |
| `0003_activities_and_exercises` | Activity + exercise taxonomy for check-ins |
| `0004_biomarker_report_foundation` | Report-grade catalog: bands, derived markers, units |
| `0005_profile_layer` | Every health row hangs off `profile_id` (multi-profile ready) |
| `0006_capture_now` | Provenance: raw-as-printed values + the lab's own printed ranges |
| `0007_push_subscriptions` | Web Push subscriptions |
| `0008_redemption_loop` | Voucher items, code pool, atomic `redeem_voucher()` |
| `0009_observability` | `client_errors` + telemetry |
| `0010_beta_waitlist` | `users.access_status` + guarded backfill |
| `0011_deletable_vouchers` | Item-name snapshots so history survives deletion |
| `0012_referrals` | `referral_code` (unique) + `referred_by` |
| `0013_points_rank_split` | `users.iki_score` + `best_streak`, ledger `base_amount`/`multiplier`, `partners`, and the `invite_codes` shared namespace |
| `0014_rls_on_partners_and_invite_codes` | RLS on the two tables 0013 added |
| `0015_wearable_connections` | Cloud wearable OAuth grants (encrypted tokens) + normalized daily metrics |

> **Migration-first, always.** Run the migration on production *before* merging
> code that depends on it. Code reading a column that doesn't exist yet takes the
> whole app down. See [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) §2.

> **Every new table gets `enable row level security` with NO policies.** Supabase
> grants `anon` and `authenticated` privileges on everything in `public`, so RLS
> is the only thing between the project's anon key and the table; the service
> role bypasses it, and every query in this app is server-side through
> `createSupabaseAdmin()`. Migration `0013` shipped two tables without it and
> `0014` had to close that live. If a migration creates a table, the same
> migration turns RLS on.

> **Clinical safety:** reference ranges seeded into `biomarker_catalog` are
> common, unvalidated adult intervals used to bootstrap the schema (every row is
> flagged `is_validated = false`). They must be reviewed by a qualified
> professional — and localized per partner lab — before any use beyond
> educational. See [`docs/REFERENCE_DATA.md`](./docs/REFERENCE_DATA.md).

---

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/HANDOVER.md`](./docs/HANDOVER.md) | **Start here.** Orientation, access transfer, priorities, known traps |
| [`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md) | Living system-of-record: features, decisions, incidents, key files |
| [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) | Deploy, migrate, rotate secrets, incident response, admin tasks |
| [`docs/STAGING.md`](./docs/STAGING.md) | The staging environment: setup, daily use, limitations |
| [`docs/TESTING.md`](./docs/TESTING.md) | Unit vs E2E suites, what's covered, and what isn't |
| [`docs/SCALING.md`](./docs/SCALING.md) | Deferred optimizations and the trigger for each |
| [`docs/REFERENCE_DATA.md`](./docs/REFERENCE_DATA.md) | How clinical reference data is stored and changed |
| [`docs/FAQ.md`](./docs/FAQ.md) | User-facing answers (points, ranks, redemption, referrals). `points.ts` is canonical; a test keeps this file honest |
| [`docs/POINTS_ECONOMY.md`](./docs/POINTS_ECONOMY.md) | Internal reference: every earn, the multiplier glide path, rank thresholds and modelled timelines |
| [`docs/WEARABLES.md`](./docs/WEARABLES.md) | Wearable integrations: which credentials to get, which need approval, how sync runs |
| [`docs/cowork/`](./docs/cowork/) | Prompts for production DB work handed to Claude Cowork, with their verification queries |
| [`AGENTS.md`](./AGENTS.md) | Next.js 16 conventions — read before writing App Router code |
