# Runbook — Ikigaro Operations

_Last updated: 2026-07-25_

Procedures for running Ikigaro in production: deploying, migrating, rotating
secrets, responding to incidents, and the routine admin tasks. Written so
someone who has never touched this system can execute each one.

New here? Read [`HANDOVER.md`](./HANDOVER.md) first.

---

## 1. Deploying

**Normal path — you never deploy by hand.**

```
open a PR → CI (lint, typecheck, test, build) → deploy to STAGING → you test it
                                                                        │
         merge to main → CI → deploy to PRODUCTION ◄─────────────────────┘
```

Every pull request deploys to a staging Worker with its own database, so changes
can be exercised before they reach the live app. Setup and daily use:
[`STAGING.md`](./STAGING.md).

`.github/workflows/ci.yml` runs both jobs; the deploy job only fires on a push to
`main` after the build job passes. Watch it in the repo's Actions tab. A merge
with no green deploy job means **your change is not live** — this has happened
before and is easy to miss.

**Before merging anything, locally:**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build      # Next build
npm run cf:build   # OpenNext/Workers build — catches Workers-only failures
```

The last one matters: code can build fine under Next and still fail on Workers
(anything reaching for a Node runtime API).

CI additionally deploys the PR to staging and runs the Playwright suite against
it — see [`TESTING.md`](./TESTING.md). A red **e2e** check means the deployed
app misbehaved, not just that a unit test failed.

**Emergency manual deploy** (CI is down and you must ship):

```bash
npm run cf:deploy   # builds and deploys with your local wrangler credentials
```

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your environment.
Use sparingly — it bypasses every check.

**Rollback.** There is no one-button rollback. In order of preference:
1. **Revert the commit** on `main` and let CI redeploy (2–4 minutes). This is
   almost always right.
2. **Cloudflare dashboard** → Workers → `ai-tools` → Deployments → roll back to a
   previous version. Faster (seconds), but the next merge to `main` overwrites
   it — only a stopgap while you prepare the revert.
3. If the bad change included a **migration**, reverting code is not enough — see
   §2. Never roll a migration back casually while users are writing data.

---

## 2. Database migrations

Schema lives in `supabase/migrations/`, applied in filename order (`0001` …
`0012` today). All migrations are written to be **idempotent** — safe to re-run.

**The rule that matters: migration first, merge second.**

Code that reads a column before its migration has run takes the entire app down
for every user. There is no partial failure here.

**Procedure:**
1. Write the migration idempotently (`IF NOT EXISTS`, guarded backfills).
2. Rehearse it on a throwaway Postgres — including running it **twice** to prove
   idempotency, and against a copy with realistic rows if it backfills.
3. Apply it to the **staging** database and exercise the PR there. This is the
   real rehearsal: same SQL, same code path, no production risk.
4. Apply to production via the Supabase SQL editor.
5. Verify (`select` the new column/table).
6. *Then* merge the code that depends on it.

**Reference-range changes** (biomarker bands, catalog values) are data, not
schema: ship an idempotent `UPDATE biomarker_catalog …` migration, no code change
and no deploy needed. See [`REFERENCE_DATA.md`](./REFERENCE_DATA.md).

**Seeding rewards:** `supabase/seed_redemption_catalog.sql` is a template, not
something to run blindly against production. Prefer the admin console (§6).

---

## 3. Secrets — where each one lives

Three separate stores. Putting a value in the wrong one is a common failure.

| Store | Set with | Survives deploy? | What's there |
|---|---|---|---|
| **Worker secrets** | `npx wrangler secret put NAME` | Yes | `ANTHROPIC_API_KEY`, `PRIVY_APP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` |
| **Worker vars** (plaintext) | committed in `wrangler.jsonc` `vars` | Replaced by this file every deploy | `ADMIN_EMAILS`, `APP_ENV` |
| **GitHub Actions secrets** | repo Settings → Secrets | n/a | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |

**Never set a plaintext var in the Cloudflare dashboard.** `wrangler deploy`
replaces the whole plaintext var set from `wrangler.jsonc` on every deploy — a
dashboard-set `ADMIN_EMAILS` was silently wiped this way, locking admin out.

`CRON_SECRET` exists in **two** stores and the values must match. Changing one
without the other silently breaks daily reminders (the Worker rejects the caller).

**Environments have separate secrets.** Staging inherits nothing — set its
values with `--env staging` (see [`STAGING.md`](./STAGING.md) §1.4). Staging vars
also don't inherit from the top-level `vars` block; `env.staging.vars` repeats
everything it needs.

---

## 4. Rotating secrets (and taking ownership on handover)

Secrets can't be read back once set. To take ownership, rotate.

**Anthropic API key**
```bash
# 1. Create a new key in the Anthropic console
npx wrangler secret put ANTHROPIC_API_KEY   # paste when prompted
# 2. Verify: upload a lab PDF in the app; extraction should work
# 3. Revoke the old key in the console
```

**Supabase service-role key**
```bash
# Rotate in Supabase dashboard → Project Settings → API
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# Verify: load any authenticated page (it reads through this key)
```

**Privy app secret** — rotate in the Privy dashboard, then
`npx wrangler secret put PRIVY_APP_SECRET`. Verify by signing in with a fresh
email OTP.

**`CRON_SECRET`** — must change in both places, close together:
```bash
npx wrangler secret put CRON_SECRET          # Worker
# then set the identical value in GitHub repo secrets → CRON_SECRET
```
Verify: Actions → "Daily reminders" → Run workflow. A mismatch shows as 401.

**VAPID keys** — avoid rotating unless compromised. Changing them **invalidates
every existing push subscription**; users must re-opt-in. If you must: generate a
new pair, update `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` in GitHub secrets and the
hardcoded public key in `src/lib/vapid-public-key.ts`, then expect subscription
churn.

**Cloudflare API token** — create a new token with `Workers Scripts: Edit`,
update the GitHub secret, delete the old token.

---

## 5. Daily reminders pipeline

**How it works:** GitHub Actions (12:30 UTC = 18:00 IST, plus a 13:05 UTC backup)
calls `GET /api/cron/due-reminders` with the `CRON_SECRET` bearer. The Worker
returns who is due (daily check-in nudges + panel-day re-test pushes) and marks
them as sent **before** returning. The Action then does the Web Push crypto and
sends. Marking before sending is what makes duplicate runs harmless.

**Test it end to end:**
1. On a device, opt in via Settings → "Daily reminders".
2. Don't check in today.
3. Actions → "Daily reminders" → Run workflow.
4. The log shows `N check-in nudge(s), M re-test push(es)`.

**"The reminder didn't arrive" — triage in this order:**
1. **Did the workflow run at all?** Check Actions history. GitHub silently skips
   scheduled runs — this is why there's a backup schedule. If neither ran, that's
   the answer.
2. **401 in the log?** `CRON_SECRET` mismatch between the Worker and GitHub (§4).
3. **403 / "Just a moment…" HTML in the log?** Cloudflare Bot Fight Mode is on and
   is challenging our own caller. Turn it off — endpoints carry their own auth.
4. **Ran clean, said 0 due?** Expected if the user already checked in, or was
   already marked sent today (at-most-once is working as designed).
5. **Said it sent, but no notification?** Device-side: the subscription may be
   expired, or notification permission was revoked. Have the user re-opt-in.

---

## 6. Routine admin tasks

All at `admin.ikigaro.com/admin`. Access requires **both** your email in
`ADMIN_EMAILS` (`wrangler.jsonc`, committed + deployed) **and** in the Cloudflare
Access policy on that hostname.

- **Approve a beta tester:** Users tab → Approve. They tap "Check again" in the
  app — no re-login needed. Revoke reverses it. Both are audit-logged.
- **Add a reward:** Rewards tab → Add item (instruction/terms presets available)
  → "Add codes" (paste one per line; duplicates skipped).
- **Delete a reward:** safe by design — users' redemption history keeps a name
  snapshot and their code; unused codes are discarded.
- **Set a vanity referral code:** Users tab → inline "Invite code" editor. Shows
  a live normalized preview; duplicates are rejected with a clear error.
- **Retune the points economy:** edit `src/lib/points.ts` and deploy. That file
  is the only place values live — UI copy and the in-app FAQ interpolate from it.
- **Read the beta's health:** Analytics tab (default) — funnel, D1/7/30
  retention, DAU/WAU/MAU, streaks, 14-day check-in chart, client errors.

---

## 7. Incident response

**First question, always: is it actually deployed?** Check the Actions tab for a
green deploy job on the relevant commit. A surprising share of "the fix didn't
work" is "the fix never shipped."

**Then, in order:** build-time env vars → did the migration run? → model latency
or thinking defaults → idle/connection timeouts → DB CHECK constraints →
Cloudflare zone features (Access, Bot Fight Mode) sitting in the request path.

**Is production actually up?** The smoke monitor answers this without guessing:
Actions → **Production smoke** → Run workflow (or check the last scheduled run).
It exercises the live app read-only and its failure summary names the likeliest
causes. See [`TESTING.md`](./TESTING.md).

**Where to look:**
- **Server errors:** Cloudflare dashboard → Workers → `ai-tools` → Logs
  (observability is enabled in `wrangler.jsonc`).
- **Client errors:** admin console → Analytics tab → client errors panel
  (`window.onerror` + unhandled rejections, including pre-auth, capped per user).
- **Database:** Supabase dashboard → Logs / SQL editor.

**Symptom → cause shortcuts** (all previously observed):

| Symptom | Likely cause |
|---|---|
| White screen for everyone | A `NEXT_PUBLIC_*` was empty at build time |
| Admin console rejects a valid admin | `ADMIN_EMAILS` wiped by a dashboard var, or Access policy mismatch |
| Extraction 502s / hangs | Model latency, thinking enabled, or idle-connection drop |
| Save returns 500 | A DB CHECK constraint (e.g. `source` enum) rejecting a value |
| Reminders stopped | GitHub skipped the run, `CRON_SECRET` mismatch, or Bot Fight Mode |
| Trends show impossible jumps | Duplicate same-date panels (now prevented by content-signature dedup) |
| A destructive admin action fired with no dialog | Browser suppressed `window.confirm` — must use `ConfirmDialog` |
| The app hangs forever on the startup splash | The hostname is missing from **Privy's allowed domains** — add it back (`STAGING.md` §1.5). Affects everyone on that host. |
| `app.ikigaro.com/admin` serves a page instead of redirecting | The `next.config.ts` host redirect stopped matching. `redirect()` in the page cannot replace it — it only emits a client-side redirect. |

**If user data is at risk, stop and get help before writing.** Reads are free;
writes against production are not reversible without a restore. Prod data is
never mutated without an explicit decision to do so.

---

## 8. Local development

```bash
npm install
cp .env.local.example .env.local   # fill in values
npm run dev                        # http://localhost:3000
```

To exercise the Workers runtime locally (closer to production than `npm run dev`):

```bash
npm run cf:preview   # builds and runs the worker in workerd
```

Verify Supabase connectivity:
```bash
node --env-file=.env.local scripts/test-supabase.mjs
```

**Rehearsing DB changes.** Migrations are rehearsed against a throwaway local
Postgres rather than production — spin one up, apply `0001` onward, then apply
your new migration twice to prove idempotency.
