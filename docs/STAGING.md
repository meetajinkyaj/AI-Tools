# Staging Environment

_Last updated: 2026-07-25_

A full copy of the app — separate Worker, **separate database** — that every
pull request deploys to automatically, so changes can be exercised against a
real deployment before they reach the live app.

```
   PR opened/updated ──► CI (lint, typecheck, test, build) ──► deploy to STAGING
                                                                     │
                                                            you test it here
                                                                     │
   merge to main ─────► CI ─────────────────────────────────► deploy to PRODUCTION
```

| | Production | Staging |
|---|---|---|
| Worker | `ai-tools` | `ai-tools-staging` |
| URL | app.ikigaro.com | *(fill in after setup — §1.6)* |
| Database | production Supabase | **its own** Supabase project |
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

**This means staging will not work until §1 is complete — by design.**

---

## 1. One-time setup

Steps 1.1–1.5 need dashboard access, so they can't be scripted here. Roughly 30
minutes.

### 1.1 Create the staging Supabase project

Supabase dashboard → New project. Name it something unmistakable like
`ikigaro-staging`. Any region; the free tier is fine.

From **Project Settings → API**, copy:
- the **Project URL** (e.g. `https://abcdefgh.supabase.co`) — public
- the **service_role key** — secret, never commit it

### 1.2 Create the schema

In the staging project's SQL editor, run every file in
`supabase/migrations/` **in filename order**, `0001` through `0012`. They are
idempotent, so a re-run is harmless.

Then confirm: `select count(*) from biomarker_catalog;` should return ~83.

> Keep this in sync going forward. When you add a migration, run it on staging
> first — that's the rehearsal that makes the production run safe.

### 1.3 Point the staging Worker at that database

In `wrangler.jsonc`, fill in the empty `SUPABASE_URL` under `env.staging.vars`:

```jsonc
"staging": {
  "vars": {
    "SUPABASE_URL": "https://YOUR-STAGING-PROJECT.supabase.co"
  }
}
```

Commit it — the URL is public, and plaintext vars **must** live in this file
(anything set in the Cloudflare dashboard is wiped on the next deploy).

### 1.4 Set the staging Worker's secrets

Secrets are per-environment — the production ones are not inherited:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging   # from 1.1
npx wrangler secret put ANTHROPIC_API_KEY         --env staging
npx wrangler secret put PRIVY_APP_SECRET          --env staging
npx wrangler secret put CRON_SECRET               --env staging   # any value
```

The Anthropic and Privy values can be the same as production. `CRON_SECRET` can
be anything — nothing calls staging's cron endpoint.

### 1.5 Allow the staging origin in Privy

Privy dashboard → your app → allowed domains → add the staging hostname.
Without this, login fails on staging with a domain error.

Staging shares the production Privy app, so the same email works on both. That
is safe — identity is shared, **data is not**, because the databases are
separate. Split them later if you ever want staging logins fully isolated.

### 1.6 First deploy, and record the URL

Open any pull request. CI builds it and deploys to staging; the run prints the
`ai-tools-staging.<your-subdomain>.workers.dev` URL. **Put that URL in the table
at the top of this file** so nobody has to dig through logs again.

Optional: add a `staging.ikigaro.com` custom domain in Cloudflare → Workers →
`ai-tools-staging` → Settings → Domains & Routes, then add that hostname to
Privy (1.5) too.

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

**Approve yourself on staging:** staging starts with an empty database, so your
first signup lands on the waitlist like any other. Open
`ai-tools-staging.<...>.workers.dev/admin` and approve yourself. (The
`app.ikigaro.com/admin` → `admin.ikigaro.com` redirect only applies to the
production hostname, so admin works directly on staging.)

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
| Login fails with a domain/origin error | Staging hostname missing from Privy's allowed domains (§1.5). |
| Every request 500s after a schema change | A migration ran on production but not staging (or vice versa). Re-run §1.2. |
| No badge in the bottom-left | You are on production, or the build didn't get `NEXT_PUBLIC_APP_ENV=staging`. Treat it as production until proven otherwise. |
| deploy-staging job skipped | It only runs on pull requests, not on direct pushes to `main`. |

Worker logs: Cloudflare dashboard → Workers → **`ai-tools-staging`** → Logs.
Check you're looking at the staging Worker, not production.
