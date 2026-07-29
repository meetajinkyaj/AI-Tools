# Staging Environment

_Last updated: 2026-07-25_

A full copy of the app — separate Worker, **separate database** — that every
pull request deploys to automatically, so changes can be exercised against a
real deployment before they reach the live app.

```
   PR opened/updated ──► CI (lint, typecheck, unit tests, build)
                              │
                              ├──► deploy to STAGING
                              │         │
                              │         └──► E2E suite runs against it
                              │                    │
                              │           you test anything it can't (docs/TESTING.md)
                              │
   merge to main ─────► CI ───┴──────────────────► deploy to PRODUCTION
```

| | Production | Staging |
|---|---|---|
| Worker | `ai-tools` | `ai-tools-staging` |
| URL | app.ikigaro.com | https://ai-tools-staging.meetajinkyaj.workers.dev |
| Database | production Supabase (`xaygldulkjjofxohescm`) | `ikigaro-staging` (`albhabiyfaqvpnxilovf`) |
| Deploys on | push to `main` | every pull request |
| Data | real users | throwaway |
| Badge | none | "Staging · not live data" |

---

## The safety property that matters

The Supabase URL falls back to **production** when `SUPABASE_URL` isn't set.
That default is correct for the production Worker and catastrophic anywhere
else — a staging deploy missing that one variable would read and write real
user data with no visible symptom.

So the app refuses to start when a non-production environment would reach the
production database (`assertNotProductionDatabase`, covered by tests). If
staging is misconfigured you get a loud error, never silent corruption.

**Verified end to end on 2026-07-25**, not just assumed: a signup on staging
created a row in the staging database only, and production's user count was
unchanged before and after. The sharpest evidence — the same person signing in
on both gets the *same* `privy_user_id` but two different user rows with
different UUIDs in two different databases. Identity is shared; data is not.

Re-run that check (§1 step 4 of the setup task) after any change to
`SUPABASE_URL`, `APP_ENV`, or the guard itself.

---

## 1. One-time setup

✅ **Complete as of 2026-07-25.** Kept here as the record of how staging was
built — follow it again to rebuild staging, or to stand up a second environment.
Steps 1.1–1.5 need dashboard access, so they can't be scripted.

### 1.1 Create the staging Supabase project

Supabase dashboard → New project. Name it something unmistakable like
`ikigaro-staging`. Any region; the free tier is fine.

From **Project Settings → API**, copy:
- the **Project URL** (e.g. `https://abcdefgh.supabase.co`) — public
- the **service_role key** — secret, never commit it

### 1.2 Create the schema

In the staging project's SQL editor, run every file in
`supabase/migrations/` **in filename order**, `0001` through `0015`. They are
idempotent, so a re-run is harmless.

Then confirm:

```sql
select count(*) from biomarker_catalog;                 -- 91 rows
select count(distinct marker_key) from biomarker_catalog; -- 83 markers
select count(*) from users;                             -- 0 (wrong project if not)
```

Both catalog numbers are correct and neither is a mistake: the product has ~83
*markers*, but the unique key is `(marker_key, sex)`, so sex-split markers like
`hdl_c` legitimately occupy two rows — 91 rows, 83 distinct markers.

**Supabase may show a "Run without RLS" / "Run and enable RLS" dialog** on
migrations 0007 and 0008, which create tables without enabling RLS in the same
statement. Choose **"Run without RLS"** — 0009 enables it on those tables a few
files later, and picking the other option deviates from the migration. (All 18
tables end up with RLS enabled; nothing is left uncovered.)

> Keep this in sync going forward. When you add a migration, run it on staging
> first — that's the rehearsal that makes the production run safe.

### 1.3 Point the staging Worker at that database

✅ **Done** — `env.staging.vars.SUPABASE_URL` in `wrangler.jsonc` points at
`ikigaro-staging`. If you ever rebuild the staging project, update it there and
commit: the URL is public, and plaintext vars **must** live in that file
(anything set in the Cloudflare dashboard is wiped on the next deploy).

### 1.4 Set the staging Worker's secrets

Secrets are per-environment — the production ones are **not** inherited:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
npx wrangler secret put ANTHROPIC_API_KEY         --env staging
npx wrangler secret put PRIVY_APP_SECRET          --env staging
npx wrangler secret put CRON_SECRET               --env staging
```

(Or the Cloudflare dashboard → Workers → `ai-tools-staging` → Settings →
Variables and Secrets, adding each as type **Secret**.)

Which value goes where:

| Secret | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **The staging project's key** (from 1.1). Not production's — that's the one mistake that would undo this whole setup. |
| `ANTHROPIC_API_KEY` | **Its own key**, issued for staging. Then it can be revoked or rate-limited without touching the live app. |
| `PRIVY_APP_SECRET` | **Must match production** — both environments share one Privy app (see 1.5). |
| `CRON_SECRET` | Any random string. Nothing calls staging's cron endpoint. |

> You cannot copy a value out of production to reuse it. Cloudflare never
> displays a secret after it's set — the dashboard just shows *Value encrypted*.
> So "same as production" only works for values you still hold elsewhere, which
> is a further reason staging gets its own Anthropic key.

### 1.5 Allow the staging origin in Privy

Privy dashboard → your app → allowed domains → add the staging origin as a
**full URL, including the scheme**:

```
https://ai-tools-staging.meetajinkyaj.workers.dev
```

A bare hostname is rejected — the field validates as a URL.

> **The rule: this list needs one entry per hostname that runs the app** —
> `app.ikigaro.com`, `admin.ikigaro.com`, the staging URL, and localhost for
> dev. **Add, never replace.** A missing entry doesn't degrade gracefully: Privy
> refuses to initialize and the app hangs on the startup splash forever, for
> everyone on that hostname.
>
> This has bitten once. Adding staging replaced both production entries, and
> app.ikigaro.com and admin.ikigaro.com were down for a day with CI fully green
> — CI only tests staging. The production smoke monitor
> ([`TESTING.md`](./TESTING.md)) now catches this within ~30 minutes. **After
> editing this list, re-read it and confirm every hostname is still present.**

Staging shares the production Privy app, so the same email works on both. That
is safe — identity is shared, **data is not**, because the databases are
separate. Split them later if you ever want staging logins fully isolated.

### 1.6 First deploy

✅ **Done** — the Worker exists and every PR redeploys it:

    https://ai-tools-staging.meetajinkyaj.workers.dev

Optional: add a `staging.ikigaro.com` custom domain in Cloudflare → Workers →
`ai-tools-staging` → Settings → Domains & Routes, then add that hostname to
Privy (1.5) too and update the URL above.

---

## 2. Everyday use

1. Work happens on a branch and opens a PR.
2. CI runs lint, typecheck, tests, and build. If any fail, nothing deploys.
3. Staging deploys automatically. Wait for the green check on the
   **deploy-staging** job.
4. Open the staging URL and exercise the change. Look for the **"Staging · not
   live data"** badge in the bottom-left — if it isn't there, you're on
   production, so stop.
5. Merge when satisfied. That deploys to production.

**Getting approved on staging.** Staging's database starts empty, so every
signup — including yours — lands on the waitlist. Admin works directly on the
staging hostname (the `app.ikigaro.com/admin` → `admin.ikigaro.com` redirect only
fires on the production host), so open
`https://ai-tools-staging.meetajinkyaj.workers.dev/admin` to approve.

**But only an `ADMIN_EMAILS` address can open that page.** Admin is the
allow-list, not beta approval. So:

- Testing as **yourself** (an admin address): sign in, open `/admin`, approve
  your own row. This works even while you're waitlisted — `requireAdmin`
  deliberately ignores `access_status`, which is what stops a fresh environment
  from deadlocking with nobody able to approve anybody.
- Testing as a **clean, non-admin account** (closer to a real user's first
  run): it cannot approve itself. Sign in with your admin address in a second
  browser or profile and approve the test account from there.

**Testing a migration:** run it on the staging database *before* opening the PR
that depends on it — same migration-first rule as production, rehearsed.

---

## 3. Deliberate limitations

- **One staging environment, shared by all PRs.** A second PR overwrites the
  first. Deploys are serialized (a CI concurrency group) so they never
  interleave, but the last one wins. Fine for one or two people; if the team
  grows, switch to per-PR preview URLs via `wrangler versions upload`.
- **No cron on staging.** Daily reminders point at `app.ikigaro.com` explicitly.
  To test reminder logic, call staging's `/api/cron/due-reminders` by hand with
  its `CRON_SECRET`.
- **Staging data is disposable.** Nobody backs it up. Wipe it whenever it gets
  cluttered — that's the point of it.
- **Staging and production builds are not byte-identical**: staging bakes in
  `NEXT_PUBLIC_APP_ENV=staging`, which renders the badge. That difference is one
  DOM node and it is what prevents confusing the two.
- **Not a load or security test.** It's a correctness rehearsal, nothing more.

---

## 4. Troubleshooting

| Symptom | Cause |
|---|---|
| Staging 500s on every page; logs say *"Refusing to connect to the production database"* | `SUPABASE_URL` is still empty in `env.staging.vars` (§1.3). The guard is working — fix the config. |
| *"Missing SUPABASE_SERVICE_ROLE_KEY"* | Secret not set for `--env staging` (§1.4). Production secrets are not inherited. |
| Login fails with a domain/origin error | Staging origin missing from Privy's allowed domains, or added as a bare hostname — it must include `https://` (§1.5). |
| Signed in on staging but stuck on the waitlist, and `/admin` won't open | That account isn't in `ADMIN_EMAILS`. Approve it from an admin account in another browser profile (§2). |
| Every request 500s after a schema change | A migration ran on production but not staging (or vice versa). Re-run §1.2. |
| No badge in the bottom-left | You are on production, or the build didn't get `NEXT_PUBLIC_APP_ENV=staging`. Treat it as production until proven otherwise. |
| deploy-staging job skipped | It only runs on pull requests, not on direct pushes to `main`. |

Worker logs: Cloudflare dashboard → Workers → **`ai-tools-staging`** → Logs.
Check you're looking at the staging Worker, not production.
