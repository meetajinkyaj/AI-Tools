# CTO Handover — Ikigaro

_Last updated: 2026-07-25_

**If you are the incoming CTO, start here.** This document is the entry point to
everything: what the product is, what exists, what you own on day one, what will
bite you, and where to pick up. Every other doc is linked from here.

The codebase was built by the founder working with an AI pair-programmer. That
has two consequences worth knowing up front: the code is unusually
well-commented and consistently structured, but there is **no second human who
has this system in their head**. These docs are the substitute. They are written
to be true, not flattering — the known weak spots are in §7 and §8.

---

## 1. Read this first (about 60 minutes)

In this order:

| # | Doc | What you get | Time |
|---|-----|--------------|------|
| 1 | This file | Orientation, access, priorities | 15 min |
| 2 | [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) | The living system-of-record: every feature, architecture decision, incident, and key file | 20 min |
| 3 | [`../README.md`](../README.md) | Get it running locally | 15 min |
| 4 | [`RUNBOOK.md`](./RUNBOOK.md) | How to deploy, migrate, rotate secrets, respond to incidents | 10 min |
| 5 | [`STAGING.md`](./STAGING.md) | The staging environment and how changes reach production | 5 min |
| 6 | [`TESTING.md`](./TESTING.md) | The two test suites, and the gap that remains | 5 min |
| 7 | [`SCALING.md`](./SCALING.md) | Deliberately deferred optimizations + the trigger for each | skim |
| 8 | [`REFERENCE_DATA.md`](./REFERENCE_DATA.md) | How clinical reference ranges are stored and changed | skim |
| 9 | [`FAQ.md`](./FAQ.md) | The user-facing answers (canonical copy for points/redemption) | skim |

Then do the day-one checklist in §5.

**Repo conventions that are not optional:**
- [`AGENTS.md`](../AGENTS.md) — this is Next.js 16, which differs from most
  training data and most blog posts. Read `node_modules/next/dist/docs/` before
  writing App Router code. Several hours were lost to this; see §7.
- Verification convention before any merge: `npm run lint` + `npx tsc --noEmit`
  + `npm test` + `npm run build` + `npm run cf:build`. CI additionally runs the
  Playwright suite against staging ([`TESTING.md`](./TESTING.md)).

---

## 2. What Ikigaro is, in one page

A longevity/health app for people who already track things (wearables, labs) and
are drowning in disconnected numbers. Three loops:

1. **Understand** — upload a lab PDF; the app extracts ~83 biomarkers, flags
   what's worth attention, and produces a doctor-shareable summary.
2. **Build the habit** — a 30-second daily check-in (energy/sleep/training),
   streaks, and trends that lead with check-in signal because panels are only
   6–12 months apart.
3. **Reward** — an "iki points" economy earned across all of the above, spent in
   a Partners marketplace (voucher codes + affiliate links) and grown through
   referrals.

**Status:** live in a gated private beta. New signups land on a waitlist and see
nothing until an admin approves them.

**Three surfaces:**

| Surface | URL | Repo | What it is |
|---|---|---|---|
| App | `app.ikigaro.com` | `meetajinkyaj/AI-Tools` | The product (this repo) |
| Admin | `admin.ikigaro.com/admin` | same repo, same Worker | Analytics, rewards, user approval |
| Marketing | `www.ikigaro.com` | `meetajinkyaj/ikigaro-os` | Landing page; all CTAs point to the app |

**Stack in one line:** Next.js 16 App Router → Cloudflare Workers (via OpenNext)
· Supabase Postgres · Privy email-OTP auth · Anthropic Claude for extraction ·
Web Push from a dedicated Cloudflare cron Worker · Tailwind v4 · Vitest (173 unit tests) +
Playwright (E2E against staging, plus a production smoke monitor).

---

## 3. What you are inheriting — honest inventory

**Genuinely solid:**
- The interpretation engine is deterministic and unit-tested. The LLM only
  transcribes numbers off a page; **code** decides high/low/band. This is the
  single most important safety property in the system — do not let it migrate
  into the model.
- Points, "same report" identity, and the beta gate each have exactly one source
  of truth (`src/lib/points.ts`, `panelContentSignature`, `resolveApprovedUserId`).
  Retuning the economy is a one-file change.
- Money-adjacent operations are atomic (`redeem_voucher()` uses `SKIP LOCKED`;
  no double-spend or double-issue is possible under concurrency).
- Every push send is at-most-once by construction, so retries and manual runs
  cannot double-notify users.
- 173 unit tests covering the domain logic (biomarkers, points, trends, future,
  check-ins, referrals, reminders, analytics, token verification), plus a
  Playwright suite that exercises the deployed staging app on every PR.

**Real debt, sized:**
- **E2E covers the signed-out surface only.** Playwright runs against staging on
  every PR (landing renders, every API route rejects anonymous callers, admin
  gate, legal pages, PWA). Everything *behind login* — onboarding, upload,
  check-in, redemption — is still verified by hand, because Privy's email-OTP
  login can't be automated without either a mail service or an auth backdoor.
  The options are laid out in [`TESTING.md`](./TESTING.md). See §8, item 1.
- **Staging exists but is single-slot.** Every PR deploys to one shared staging
  Worker, so concurrent PRs overwrite each other (deploys are serialized, last
  one wins). Fine for one or two people; past that, move to per-PR preview URLs
  (`wrangler versions upload`). See [`STAGING.md`](./STAGING.md) §3.
- **The marketing site is a 12.4MB machine-generated snapshot** that compiles JSX
  in the browser via Babel. It works and it looks good, but it is unmaintainable
  by hand and slow on mobile. A rebuild is scoped and deferred (§8, item 5).
- **Clinical reference ranges are not validated.** Every catalog row is flagged
  `is_validated = false`. They are common adult intervals used to bootstrap. A
  qualified professional must review them before this is anything other than
  educational. The product's disclaimer language reflects this today.
- **One person's accounts.** Everything is under the founder's personal logins.
  §4 is the fix and it is your first task.

---

## 4. Access & accounts transfer checklist

**This is the actual handover.** Code is public to whoever has the repo; access
is what makes someone able to operate the system. Work through this with the
founder in one sitting.

Legend: **P0** = you cannot operate without it · **P1** = needed within week one.

| # | System | What it controls | Transfer action | Pri |
|---|--------|------------------|-----------------|-----|
| 1 | **GitHub** — `meetajinkyaj/AI-Tools`, `meetajinkyaj/ikigaro-os` | Source of truth; CI deploys from `main` | Add as admin. Longer term move both repos to a **GitHub organization** so ownership isn't a personal account. | P0 |
| 2 | **Cloudflare** (account `21510d84b951ec23fc0b34eb316e6546`) | Workers `ai-tools` (app+admin), `ai-tools-staging`, `ikigaro-reminders` (daily push cron), `ikigaro-os`; DNS for all hostnames; Cloudflare Access on admin | Invite as account member with Workers + DNS + Access admin. | P0 |
| 3 | **Supabase** | The entire database — all user and health data | Add as project owner/admin. Confirm **PITR/backup posture** while you're in there (see §7). | P0 |
| 4 | **Privy** | Auth. If this is lost, nobody can log in | Add to the Privy app team. App ID `cmr7snzr8003e0ejvn5y0sppr` is public; the **app secret** is a Worker secret. | P0 |
| 5 | **Anthropic Console** | The extraction API key; the billing that stops report uploads when exhausted | Add to the org; set a **spend alert** — there is none today. | P0 |
| 6 | **Domain registrar** (ikigaro.com) | Everything, ultimately | Confirm who holds it; add access or transfer to a company account. | P0 |
| 7 | **GitHub Actions secrets** | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Repo admin (#1) gives you write access. Values are not readable — rotate rather than retrieve (RUNBOOK §4). | P1 |
| 8 | **Worker secrets** | `ANTHROPIC_API_KEY`, `PRIVY_APP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` on `ai-tools`; `CRON_SECRET` + `VAPID_PRIVATE_KEY` on `ikigaro-reminders` | Set via `npx wrangler secret put`. Not readable after being set — rotate to take ownership. | P1 |
| 9 | **`ADMIN_EMAILS`** in `wrangler.jsonc` | Who can open the admin console | Add your email, commit, deploy. It is a committed plaintext var **on purpose** (§7, item 3). | P1 |
| 10 | **Cloudflare Access** on `admin.ikigaro.com` | Second gate in front of admin | Add your email to the Access policy — separate from #9; both must allow you. | P1 |
| 11 | **Email** — `hello@ikigaro.com` | User-facing contact on the app, marketing site, and legal pages | Get a mailbox/alias. | P1 |
| 12 | **Google Analytics / other marketing tooling**, if any | Marketing-site measurement | Confirm with the founder whether anything exists; the app's own analytics are first-party and in-repo. | P1 |

**Rotation-on-handover policy.** If the previous holder should no longer have
production access, rotate every secret in #7 and #8 rather than trying to read
them. The procedure is in [`RUNBOOK.md`](./RUNBOOK.md) §4 and takes about 20
minutes. `CRON_SECRET` must be changed in **both** places at once (Worker secret
and GitHub secret) or daily reminders stop.

---

## 5. Day one / week one

**Day one — prove you can operate it:**
1. Complete all P0 rows in §4.
2. Clone, `npm install`, `npm run dev`, sign in with your own email against the
   dev config (README §Getting started).
3. Run the full verification chain — `npm run lint && npx tsc --noEmit && npm
   test && npm run build && npm run cf:build`. All five must pass before you
   trust any change you make.
4. Add your email to `ADMIN_EMAILS` + the Cloudflare Access policy, deploy via a
   PR to `main`, and confirm the admin console loads at `admin.ikigaro.com/admin`.
   **You have now done a production deploy end to end.** That is the day-one goal.
5. Read the admin Analytics tab. That is the real state of the beta.

**Week one — build your own map:**
6. Read `src/lib/biomarkers.ts` and `src/lib/points.ts` in full. They are the
   product's two engines and are the highest-consequence files in the repo.
7. Trace one full request: `src/app/api/biomarkers/route.ts` (upload/save) top to
   bottom, including the dedup and award paths.
8. Do a real user run-through on a phone: sign up on a fresh email, get yourself
   approved from the admin console, upload a real lab PDF, check in, redeem
   something. Bugs surface here that no test catches.
9. Run the reminder pipeline manually (RUNBOOK §5) so you've seen a push land.
10. Read §7 below twice. It is the accumulated "why is it like that" and every
    item cost real debugging time.

---

## 6. System map

```
                    ┌──────────────────────────────────────────┐
  www.ikigaro.com   │ Worker: ikigaro-os                       │
  (marketing) ─────►│  static snapshot + edge-injected CTAs    │──► app.ikigaro.com
                    └──────────────────────────────────────────┘

                    ┌──────────────────────────────────────────┐
  app.ikigaro.com   │ Worker: ai-tools (Next.js via OpenNext)  │
  admin.ikigaro.com │                                          │
        │           │  /(app)          → the product UI        │
        │           │  /(app)/admin    → admin console         │
        └──────────►│  /api/*          → all server logic      │
                    └───────┬─────────────────┬────────────────┘
                            │                 │
                   ┌────────▼──────┐  ┌───────▼────────┐  ┌──────────────┐
                   │ Supabase      │  │ Anthropic      │  │ Privy        │
                   │ (Postgres)    │  │ (extraction)   │  │ (email OTP)  │
                   └───────────────┘  └────────────────┘  └──────────────┘

  GitHub Actions ──► CI: lint/typecheck/test/build → deploy on push to main
                 └─► Reminders: 12:30 + 13:05 UTC → asks the Worker who's due,
                                                     sends Web Push itself
```

**Why reminders are their own Worker:** the app decides *who* is due and *what*
to say; a separate `ikigaro-reminders` Worker on a Cloudflare cron trigger does
the scheduling and sending. It used to be GitHub Actions, until GitHub's
scheduler proved to run it 90–110 minutes late every day. Sends are marked
**before** hand-off, so a duplicate run can never double-notify — which is what
makes keeping the GitHub workflow as a late backup safe.

**Auth flow:** Privy issues an email-OTP token → client sends it to
`POST /api/auth/sync` → the Worker verifies it locally with `crypto.subtle`
(hand-rolled, because the standard libraries bundle `node:crypto` and don't run
on Workers) → user is upserted in Supabase. Every subsequent API call carries
that bearer token.

**The beta gate:** `resolveApprovedUserId` in `src/lib/app-user.ts`. A waitlisted
user resolves to *no user* at all eight data-route lookup sites, so they cannot
read or write anything. Approval is an admin action.

---

## 7. Things that will bite you

Each of these cost real debugging time. They are also in `PROJECT_STATUS.md` §5;
they are repeated here because they are the highest-value paragraphs in the
handover.

1. **This is Next.js 16 and it is not the Next.js you know.** `middleware` is
   renamed `proxy`, and proxy runs on the Node runtime, which OpenNext/Workers
   **cannot run at all**. That's why host-based redirects (app→admin subdomain)
   live in a server component (`src/app/(app)/admin/page.tsx`) instead of
   middleware. Read `node_modules/next/dist/docs/` before assuming any App
   Router convention.
2. **Migration-first, always.** Deploying code that reads a column before its
   migration has run takes the whole app down. Run the migration on production
   Supabase *first*, confirm, *then* merge. Merging is the second step. This was
   nearly learned the expensive way during the waitlist deploy.
3. **`wrangler deploy` replaces plaintext vars.** Anything you set in the
   Cloudflare dashboard as a plaintext var is wiped on the next deploy. This
   silently disabled the admin console once. Non-secret vars **must** live in
   `wrangler.jsonc` `vars`. Secrets set via `wrangler secret put` are separate
   and do survive.
4. **`NEXT_PUBLIC_*` inlines at build time.** If it's missing in CI, you ship a
   white screen — which happened. That's why the Supabase URL, Privy app ID, and
   VAPID public key are hardcoded defaults in `src/lib/*`. They are public values;
   this is deliberate, not sloppiness.
5. **GitHub's cron is not reliable** — in two distinct ways. It silently skipped
   a scheduled run entirely (2026-07-24), and it ran the same job 90–110 minutes
   late every day thereafter. Reminders now run on a Cloudflare cron Worker;
   GitHub is only a backup. Don't move anything time-sensitive back onto it.
6. **Cloudflare Bot Fight Mode is off on purpose.** It served a managed challenge
   to our own GitHub Actions cron caller and 403'd it. Every endpoint carries its
   own auth. If someone turns BFM on, reminders break silently.
7. **`window.confirm` can be suppressed by the browser** and then returns `true`
   — a user clicked delete, saw no dialog, and the delete went through. All
   destructive admin actions go through the in-app `ConfirmDialog`. Never
   reintroduce `window.confirm`.
8. **Check the Supabase backup posture before you need it.** I have not verified
   what point-in-time-recovery tier this project is on. Do this in week one — it
   is the single highest-severity unknown in the system, because the database is
   the only irreplaceable asset.

**Debugging order when something works locally but fails in production:**
(a) is it actually deployed? (b) build-time env vars, (c) did the migration run?
(d) model latency/thinking defaults, (e) idle/connection timeouts, (f) DB CHECK
constraints, (g) Cloudflare zone features (Access, Bot Fight Mode) in the path.

---

## 8. Where to kick off from

Ordered by what I'd actually do first, with the reasoning — disagree freely once
you have your own read.

**1. Authenticated E2E coverage.** Staging and a Playwright suite both exist now:
every PR deploys to `ai-tools-staging` and CI exercises the signed-out surface in
a real browser ([`TESTING.md`](./TESTING.md)). The gap is everything behind login
— onboarding, panel upload and confirmation, check-ins, redemption — which is
still hand-verified because Privy's email-OTP flow resists automation. The clean
fix is a test mailbox the suite can read OTPs from (Mailosaur or a catch-all
inbox); the tempting fix, a test-only auth bypass, would be a permanent backdoor
in an app holding health data and should be refused. Do this before the critical
path gets more complex.

**2. Verify the backup/restore path.** Confirm the Supabase PITR tier, then
actually perform a restore into a scratch project. An unrehearsed backup is a
hope, not a backup. Half a day; removes the biggest single-point risk.

**3. Get real beta signal.** ~20–30 testers are the immediate plan. The admin
Analytics tab already tracks the funnel, D1/7/30 retention, and DAU/WAU/MAU.
Watch two things: does the report land (do people upload a second panel?), and
does the daily check-in survive week one? Those two answers should reorder
everything below this line.

**4. Family vault / multi-profile UI.** The schema has supported it since
migration 0005 — every health row already hangs off `profile_id` and one "self"
profile is auto-created per user. This is a UI project on a done data model,
which makes it the cheapest large feature available. It's also the compliant path
for under-18 users (guardian accounts) and the "track my parents' health" use
case, which is the strongest word-of-mouth driver in this category.

**5. Personalized recommendation loop under Partners.** A deterministic
marker→intervention catalog that the model *presents* rather than invents,
surfacing partner products and unmonetized food suggestions beside them.
Deliberately under Partners, not the Report — the Report must stay clinical and
unmonetized. Blocked on a real partner catalog, not on engineering.

**6. Marketing-site rebuild.** Replace the 12.4MB Babel-in-the-browser snapshot
with a hand-authored static page. It's a design project more than a code one,
which is why it's deferred; the current site works and converts to the app fine.
Do it when you have design capacity, not before.

**Also queued, smaller:** prompt caching on extraction (cheapest cost win, see
`SCALING.md` #1) · per-user upload rate limits before signup opens wider ·
counsel's pass on Terms §1/§14 and the privacy policy vs. India's DPDP ·
clinical validation of catalog reference ranges.

---

## 9. Conventions to keep (or consciously replace)

These aren't sacred, but each exists for a reason. If you change one, change it
deliberately.

- **The model never decides clinical meaning.** It transcribes; `biomarkers.ts`
  interprets. Human confirmation before save is the accuracy backstop.
- **Single sources of truth stay single.** Points values, "same report" identity,
  and the beta gate each live in exactly one place. Resist inlining them.
- **Reference data lives in the DB, not code** — range changes ship as idempotent
  migrations with no deploy (`REFERENCE_DATA.md`).
- **Every reading carries provenance** — the lab's own printed range vs. our
  catalog's. Keep this as data sources multiply.
- **Points-affecting operations must be idempotent.** Every earn path has a
  replay guard; every push send is marked before it's handed off.
- **Prod data is never mutated without an explicit ask**, and DB changes are
  rehearsed on a throwaway Postgres before they touch production.
- **The disclaimer is fixed copy:** "Educational, not a diagnosis — please
  consult a doctor." Don't soften it without counsel.

---

## 10. Open questions for the founder

Ask these directly; they're not answerable from the code.

1. Who legally owns the domain and the Cloudflare/Supabase/Anthropic accounts
   today — a personal identity or a company entity? Moving to company ownership
   is cleanest before more people are added.
2. What is the intended monetization? Affiliate/voucher economics are built; the
   subscription question is entirely unanswered in the codebase.
3. Has counsel actually reviewed Terms §1 (eligibility, minors with guardian
   consent) and §14 (rewards + referrals)? Both are drafted and flagged pending.
4. Is there a clinical advisor lined up to validate the reference ranges? This
   gates any claim stronger than "educational."
5. What does the founder consider the beta's success criteria? That determines
   whether item 3 or item 4 in §8 comes first.
