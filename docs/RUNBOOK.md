# Runbook — Ikigaro Operations

_Last updated: 2026-07-27_

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

## 2b. Backups — READ THIS BEFORE YOU NEED IT

> ### ⚠️ As of 2026-07-27 there are NO backups of the production database.
>
> Verified in the Supabase dashboard, not assumed: project
> `xaygldulkjjofxohescm` is on the **Free plan**, which states plainly that it
> *"does not include project backups."* No daily snapshots, no retention window,
> no Point-in-Time Recovery.
>
> **If the database is lost today, everything is lost.** Every user, profile,
> check-in, blood panel, reading and points transaction — permanently, with no
> recovery path. Not "up to 24 hours of data". All of it.
>
> The dashboard's **"Restore to new project"** button does not help. It restores
> *from a scheduled backup*, and there are none. The one obvious recovery button
> in the UI does nothing for us — do not be reassured by its presence.

Everything else in this system is disposable. The app, the Workers, the DNS, the
CI pipeline — all rebuildable from this repo in an afternoon. The database is the
only thing that cannot be rebuilt from anything.

### Fixing it (in order)

| Step | What it buys | Cost |
|---|---|---|
| 1. Manual `pg_dump` (below) | One snapshot, right now. Ends the zero-backup state today. | Free |
| 2. **Supabase Pro** | Automatic daily backups, 7-day retention. Worst-case loss drops from *everything* to *~24 hours*. | $25/mo |
| 3. Off-site copy | Survives loss of the Supabase account itself — see the caveat below. | ~free |
| 4. PITR add-on | Rewind to any second in the last 7 days. Worst case ~minutes. | +$100/mo |

**Step 2 is the one that matters.** Step 4 is not worth it until user volume is
much higher.

### The current decision, and what should change it

**Founder's call, 2026-07-27: stay on Free for now, revisit at 20 testers.**

This is a considered acceptance of a known risk, not an oversight. At
single-digit users the data at risk is a handful of records that testers could
re-enter, so $25/mo buys little today.

**The trigger is ~20 testers.** Do not treat that as a soft target. The
calculation inverts fast, for two reasons that compound:

- **The loss stops being recoverable by asking.** Three people will happily
  re-enter a check-in. Twenty will not re-upload blood panels, and a beta
  cohort that loses its data does not come back.
- **The trust cost is asymmetric.** Losing early testers' health data is not a
  technical setback; it is the end of a beta and the story that follows the
  product.

Anyone reading this after that threshold has passed: the decision above has
expired. Turn on Pro.

**Two switches flip at ~20 testers, and they are in different files.** Turning
on backups is only half of it:

| Switch | Where | Today | At ~20 testers |
|---|---|---|---|
| `DB_BACKUPS` | `wrangler.jsonc` (both envs) | `"none"` | `"protected"`, once a restore is rehearsed |
| `INVITE_LINK_ON_SHARED_CARDS` | `src/lib/share-card.ts` | `false` | `true` |

The second one hides the referral link on shared images while access is
invite-only — a card advertising a join link points strangers at a door that
does not open, and they leave with a waitlist screen as their first impression
of the product. Nothing about the referral system is disabled: codes,
attribution and rewards all still work, and the code stays visible in-app for
anyone passing it on deliberately. Both enabled and disabled states are
covered by tests, so flipping it back is a verified one-line change.

**You will not have to remember this.** The threshold is enforced in code, not
by this paragraph. `src/lib/backup-risk.ts` compares the live signup count
against it, and the admin console's Analytics tab shows the result directly
above the funnel: a quiet one-line note while the count is under, and an
unmissable banner the moment it is over. It sits next to the very number that
expires the decision, because that is where the person who can act on it is
already looking.

It reads the `DB_BACKUPS` var in `wrangler.jsonc`, which is `"none"` today.
**Anything other than the exact string `protected` counts as unprotected** —
including the variable being missing entirely. That is deliberate: a typo or a
fresh environment must not be able to silence the warning, because wrongly
warning costs a moment's annoyance and wrongly staying quiet costs every user's
health data.

Once you turn on Pro **and have rehearsed a restore**, set
`"DB_BACKUPS": "protected"` and deploy. Do not set it just because you have
paid — the flag claims recoverability, and that is only true once it has been
tested.

**The caveat on step 3:** Pro's backups live *inside the same Supabase account as
the database they protect*. That is a correlated failure — an account
suspension, a billing lapse or a compromised login takes the database and its
backups together. An off-site copy is the only thing that survives that class of
failure, which is why it is on this list even though Pro covers the common case.

### The manual snapshot

Run from a machine that can reach the internet — not from CI, and not from an
agent sandbox:

```bash
# Connection string: Supabase dashboard → Project Settings → Database → URI
pg_dump "postgresql://postgres:[PASSWORD]@db.xaygldulkjjofxohescm.supabase.co:5432/postgres" \
  --no-owner --no-privileges \
  -f "ikigaro-$(date +%Y-%m-%d).sql"
```

**The dump file is a complete copy of every user's health data.** Treat it as
such:

- Encrypt it if it is going to sit anywhere (`age`, `gpg`, or an encrypted disk
  image). An unencrypted copy in `~/Downloads` is a data breach waiting for a
  lost laptop.
- Do not put it in Dropbox/Drive/iCloud unencrypted, and do not email it.
- Do not commit it. `.gitignore` now covers `*.sql`, `*.dump` and the encrypted
  variants, re-including only `supabase/migrations/` and the seed template — so
  a dump dropped anywhere in the repo, including inside `supabase/`, is ignored.
  Git history is forever: a dump committed once and deleted later is still
  published.
- Delete it once a real backup mechanism exists.

A manual dump is a **snapshot, not a backup**. It captures one moment and will
never run again unless a human remembers. It buys time to do step 2; it is not
step 2.

### Verifying a restore actually works

Once backups exist, rehearse the restore — an unrehearsed backup is a hope, not a
backup. The drill:

1. Restore the latest backup into a **new, throwaway** project. Never onto
   production (`xaygldulkjjofxohescm`) or staging (`albhabiyfaqvpnxilovf`) — a
   restore *overwrites*.
2. Time it. That number is how long Ikigaro is down in a real outage.
3. Compare against production: row counts for all 18 tables, and
   `select tablename, rowsecurity from pg_tables where schemaname='public'` —
   all 18 must still show `true`. A restore that silently drops RLS is a
   security regression, not a successful recovery.
4. `biomarker_catalog` should show **91 rows / 83 distinct `marker_key`s**. The
   gap is markers split by sex and is correct — not a partial restore.
5. Delete the throwaway project. It holds real health data.

Expect fast-moving tables (`daily_checkins`, `events`, `client_errors`,
`points_transactions`) to be slightly behind production. That gap *is* the
data-loss window, measured rather than guessed. A gap in slow-moving tables
(`users`, `biomarker_catalog`, `redemption_items`) is not expected and needs
investigating.

---

## 3. Secrets — where each one lives

Three separate stores. Putting a value in the wrong one is a common failure.

| Store | Set with | Survives deploy? | What's there |
|---|---|---|---|
| **Worker secrets** | `npx wrangler secret put NAME` | Yes | `ai-tools`: `ANTHROPIC_API_KEY`, `PRIVY_APP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` · `ikigaro-reminders`: `CRON_SECRET`, `VAPID_PRIVATE_KEY` |
| **Worker vars** (plaintext) | committed in `wrangler.jsonc` `vars` | Replaced by this file every deploy | `ADMIN_EMAILS`, `APP_ENV` |
| **GitHub Actions secrets** | repo Settings → Secrets | n/a | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |

**Never set a plaintext var in the Cloudflare dashboard.** `wrangler deploy`
replaces the whole plaintext var set from `wrangler.jsonc` on every deploy — a
dashboard-set `ADMIN_EMAILS` was silently wiped this way, locking admin out.

`CRON_SECRET` now exists in **three** places and all must match:
the `ai-tools` Worker, the `ikigaro-reminders` Worker, and the GitHub Actions
secret. Change one without the others and reminders fail with
`due-reminders failed: HTTP 401` — loudly, at least, not silently.

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

**`CRON_SECRET`** — must change in all three places, close together:
```bash
npx wrangler secret put CRON_SECRET                                        # app Worker
npx wrangler secret put CRON_SECRET --config workers/reminders/wrangler.toml  # reminders Worker
# then set the identical value in GitHub repo secrets → CRON_SECRET
```
Verify with the reminders Worker's manual trigger (§5) — a mismatch between the
reminders Worker and the app shows as `due-reminders failed: HTTP 401`; a
mismatch in what you send shows as `Unauthorized`.

**VAPID keys** — avoid rotating unless compromised. Changing them **invalidates
every existing push subscription**; users must re-opt-in. If you must: generate a
new pair, update `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` in GitHub secrets and the
hardcoded public key in `src/lib/vapid-public-key.ts`, then expect subscription
churn.

**Cloudflare API token** — create a new token with `Workers Scripts: Edit`,
update the GitHub secret, delete the old token.

---

## 5. Daily reminders pipeline

**How it works.** The `ikigaro-reminders` Cloudflare Worker (`workers/reminders`)
fires on a Cloudflare cron trigger at 12:30 UTC (18:00 IST). It calls
`GET /api/cron/due-reminders` on the app with the `CRON_SECRET` bearer; the app
returns who is due — daily check-in nudges plus panel-day re-test pushes — and
marks them notified **before** returning. The Worker then sends the Web Push
itself (`src/lib/web-push.ts`, RFC 8291/8292 on Web Crypto).

Marking before sending is what makes every send **at-most-once**: a retry, a
manual run, or the backup workflow can never double-notify anyone.

**Why not GitHub Actions any more.** It was the sender until GitHub's scheduler
proved to run it 90–110 minutes late *every day* (measured across four days),
turning a 6 PM nudge into a 7:40 PM one. `.github/workflows/reminders.yml` is
still there as a **backup and break-glass manual sender** — when it fires late
it simply finds 0 due and does nothing.

**Why keep the backup running rather than retiring it?** Two senders sounds
untidy, but sends are at-most-once and Cloudflare always fires first, so the
GitHub run is a no-op on a normal day. Its value is on an abnormal one: nothing
currently *alerts* if the Worker's cron stops firing, so the backup is the only
thing that would still get a (late) reminder out. Retire it once either (a) the
Worker has a week of confirmed on-time delivery and you accept the risk, or
(b) something actually monitors the reminder pipeline. When you do, prefer
removing just its `schedule:` and keeping `workflow_dispatch` as a manual
escape hatch.

**Secrets** (set once on the reminders Worker; they persist across deploys):

```bash
npx wrangler secret put CRON_SECRET       --config workers/reminders/wrangler.toml
npx wrangler secret put VAPID_PRIVATE_KEY --config workers/reminders/wrangler.toml
```

`CRON_SECRET` must equal the app Worker's value, or every run 401s. The VAPID
public key is a committed plaintext var in that Worker's `wrangler.toml` and
must match `src/lib/vapid-public-key.ts`.

**Test it end to end without waiting for 6 PM:**

1. On a device, opt in via Settings → "Daily reminders", and don't check in.
2. Trigger the Worker directly:
   ```bash
   curl -X POST https://ikigaro-reminders.<your-subdomain>.workers.dev \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   It replies with a summary line: `<date>: N check-in nudge(s), M re-test
   push(es) — sent X, expired Y, failed Z`.
3. Or use the backup: Actions → "Daily reminders (backup)" → Run workflow.

**Did it run at all?** Cloudflare → Workers & Pages → `ikigaro-reminders` →
**Cron Triggers** shows the schedule (`30 12 * * *`) and the last run; **Logs**
shows each run's summary line. Nothing alerts on a *missed* run, which is the
main reason the GitHub backup is still enabled — see below.

**"The reminder didn't arrive" — triage in this order:**

1. **Did the Worker run?** Cloudflare dashboard → Workers → `ikigaro-reminders`
   → Logs. Each run logs the summary line above.
2. **Summary says 0 due?** Working as designed — that user already checked in,
   or was already marked notified today.
3. **`due-reminders failed: HTTP 401`?** `CRON_SECRET` differs between the app
   Worker and the reminders Worker (§4).
4. **`Missing CRON_SECRET or VAPID_PRIVATE_KEY`?** Secrets were never set on the
   reminders Worker — they are per-Worker and inherit nothing.
5. **Says sent, but nothing on the phone?** Device-side: subscription expired
   (it would be counted as `expired`), or notification permission revoked. Have
   the user toggle the setting off and on to re-subscribe.
6. **`failed` count > 0?** The push service rejected it. A 401/403 there means
   the VAPID keypair doesn't match what the browser subscribed with — check the
   public key in `workers/reminders/wrangler.toml` against
   `src/lib/vapid-public-key.ts`.

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
