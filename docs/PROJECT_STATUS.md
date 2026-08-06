# Ikigaro. Project & Session Reference

_Last updated: 2026-07-30_

A living reference for the Ikigaro app: architecture, what's built, how to
operate it, and the known follow-ups. Update this as work lands.

> **New to the project?** Read [`HANDOVER.md`](./HANDOVER.md) first, it orients
> you and links every doc in reading order. Operational procedures (deploy,
> migrate, rotate secrets, incident response) live in [`RUNBOOK.md`](./RUNBOOK.md).

## 1. Project snapshot

- **What it is:** Ikigaro, a longevity/health app. Users upload lab reports and
  log daily check-ins; the app extracts biomarkers, flags what's worth
  attention, projects a six-month outlook, and runs an iki-points loop with a
  voucher/affiliate redemption marketplace. Currently in a **gated private
  beta** (waitlist → admin approval).
- **Live:** app (`app.ikigaro.com`) · admin (`admin.ikigaro.com`, Cloudflare
  Access-gated) · marketing (`www.ikigaro.com`)
- **Repos:** `meetajinkyaj/AI-Tools` (the app) · `ikigaro-os` (marketing site)
- **Stack:** Next.js 16 (App Router) → **Cloudflare Workers via OpenNext** ·
  **Supabase Postgres** (RLS enabled everywhere, *no* policies; service-role
  key server-only) · **Privy** email-OTP auth (hand-rolled token verification
  via `crypto.subtle`, not the Privy SDK, so it runs on Workers) · Tailwind v4
  · Vitest unit tests + Playwright E2E · Web Push (VAPID) from a
  dedicated Cloudflare cron Worker.
- **Key non-sensitive IDs:** Worker name `ai-tools` · Cloudflare account
  `21510d84b951ec23fc0b34eb316e6546` · Privy app ID `cmr7snzr8003e0ejvn5y0sppr`
  (public; hardcoded default in `src/lib/privy-app-id.ts`) · VAPID public key
  (hardcoded in `src/lib/vapid-public-key.ts`).
- **Extraction model:** `claude-sonnet-5`, thinking **disabled**, overridable via
  env `ANTHROPIC_EXTRACTION_MODEL`. Key is a Worker secret `ANTHROPIC_API_KEY`.

## 2. What's built (all live)

1. **Baseline Biomarker Report**. PDF upload → text-layer extraction (`unpdf`,
   vision fallback) → Claude transcribes onto the ~83-marker catalog → human
   confirmation screen → deterministic flags/bands/derived markers/unit
   canonicalization on save. Report leads with "Worth a look" (incl. borderline);
   the full per-category breakdown is collapsed behind "See all N markers".
   Exact-duplicate re-saves return the existing panel (content-signature dedup).
2. **Profile layer**, every health row hangs off `profile_id`; one auto-created
   "self" profile per user today; multi-profile family vault is the planned
   add-on (also the compliant path for minors' data via guardian accounts).
3. **Daily check-ins**, energy/sleep/training/exercises, streaks, and the
   points economy. **Capture-now provenance**: raw-as-printed values + the
   lab's own printed ranges stored on every reading; intervention log.
4. **Trends**, leads with the daily check-in signal (panels are 6-12 months
   apart); biomarker deltas on distinct test dates; outcome-verified rewards
   (healthy-direction continued improvement, ≥14 days apart, capped).
5. **Points economy, two currencies, one ledger.** All values in
   `src/lib/points.ts` (single source of truth, trivially retunable); the full
   earn reference is `docs/POINTS_ECONOMY.md`.
   - **Points** (`reward_points.points_balance`), spendable, boostable by a
     partner multiplier, reduced by redemptions.
   - **Iki Score** (`users.iki_score`), lifetime, BASE amounts only before any
     multiplier, never reduced by spending. Drives rank. This split is what
     stops a voucher purchase demoting you and stops a 2x partner code buying
     status.

   Earns: check-in 10 · streak 50/150/250/500/1,000 at 7/30/90/180/365 · first
   panel 200 · re-test 150 · outcome bonus 50/marker (max 3) · welcome grant
   150 (spendable only, never scored). Anti-farm: date guard,
   content-signature replay guard (same report never earns twice), and streak
   milestones that pay **once ever on personal best** (`users.best_streak`)
   rather than whenever the streak equals 7, the old rule paid people to break
   the habit, and 7-on/1-off beat a perfect year by 38%.
6. **Doctor-Ready PDF**, client-side jsPDF (lazy-loaded), Web Share API to
   WhatsApp/Telegram, Latin-1 glyph sanitizer.
7. **PWA**, installable (manifest + brand icons generated from
   `brand/ikigaro-app-icon-512.png` by `npm run icons`, never hand-edit
   `public/`), conservative service
   worker (offline fallback only; no app/API caching), install prompt
   (Chromium button / iOS share-sheet hint).
8. **Daily reminders**, opt-in Web Push ("Daily reminders" toggle in
   Settings). Sent by the **`ikigaro-reminders` Cloudflare Worker**
   (`workers/reminders`) on a Cloudflare cron trigger at 12:30 UTC (18:00 IST);
   `/api/cron/due-reminders` (CRON_SECRET) returns who's due and marks them
   before returning, so sends are **at-most-once**. Web Push crypto is
   hand-rolled on Web Crypto (`src/lib/web-push.ts`, RFC 8291/8292) and verified
   against the official RFC 8291 §5 test vector. GitHub Actions is now only a
   late backup / break-glass sender.
9. **Panel-day push**, once per panel cycle, when the ~6-month re-test window
   opens: "Your re-test window is open… earns +150 iki points". Same pipeline;
   `retest_reminder_sent` guard; replaces that day's check-in nudge.
10. **Future You**, habit momentum 0-100 (consistency/sleep/training/energy)
    leads; flagged markers get directional outlooks (`habit_v1`, no invented
    numbers) upgraded to clamped linear projections (`linear_v1`) with 2+ real
    test dates; re-test scoreboard card; active-interventions "running
    experiment" framing. Motivational, not diagnostic.
11. **Redemption marketplace (Partners tab)**, voucher items (points → instant
    code from a pre-loaded pool, atomic `redeem_voucher()` with SKIP LOCKED; no
    double-spend/double-issue) + affiliate items (free click-out, disclosure
    line, click logging). Copyable codes; collapsible redemption history that
    survives item deletion (name snapshot). How-to-redeem explainer + FAQ.
12. **Beta waitlist**, new signups land waitlisted (verified email via Privy
    OTP), see a branded waitlist screen, and are invisible to every data API
    (`resolveApprovedUserId` choke point). Admin approves/revokes from the
    console (audit-logged); waitlisted logins don't pollute DAU.
13. **Admin console** (`admin.ikigaro.com/admin`). Analytics (default tab:
    funnel, D1/7/30 retention, DAU/WAU/MAU, streaks, 14-day check-in chart,
    client errors) · Rewards (add/delete items with instruction presets, bulk
    code upload, inventory) · Users (roster + approve/revoke, vanity invite
    codes, and an **Onboarded** tick, "has a self profile", the same test the
    app uses, so the console cannot disagree with what the user sees; the
    header counts "approved, not onboarded", which is the beta's real
    drop-off) · **Partners** (create/rename/retune/deactivate an Accelerated
    Points code, per-partner roll-up, and the roster who joined through it).
    Destructive
    actions go through an in-app ConfirmDialog (never `window.confirm`).
    Auth: `ADMIN_EMAILS` allow-list (fail-closed) + Cloudflare Access;
    `app.ikigaro.com/admin` redirects to the admin subdomain.
14. **Observability**, `POST /api/telemetry`: `app_opened` beacon (approved
    users only, deduped/day → powers retention) + client error capture
    (window.onerror/unhandledrejection, pre-auth included, capped). Server
    errors: Cloudflare Workers observability.
15. **Age policy**, no minimum age (per legal review); under-18s use with
    parent/guardian consent (Terms §1); onboarding shows the consent note.
    Rewards/points terms live in Terms §14 (`/terms#rewards`, draft pending
    counsel's wording pass).
16. **Referrals**, name-based codes (`?ref=AJINKYA`; numbered on collision,
    random fallback, generated lazily) + admin-assigned vanity codes ("FITTR",
    inline editor in the Users tab with live normalize/preview). Attribution
    at signup only (`referred_by`); **tiered milestone earns** to the referrer
    via one shared `awardReferralMilestone` (at-most-once per milestone+friend,
    best-effort): +100 friend onboards (`referral`), +50 first 7-day streak
    (`referral_streak`), +150 first panel within 30 days (`referral_panel`), max 300 per friend (`REFERRAL_MAX_TOTAL`). **Referrer volume milestones**
    mirror the check-in streak ladder, +50 at 7 friends onboarded, +150 at 30
    counted off `referral` ledger rows, so they track friends who actually
    onboarded rather than raw signups. Invite card (Share + Copy) on Partners;
    Terms §14 referral clause keeps values out of legal text.
    **The invite link is OFF on shared cards during closed beta**
    (`INVITE_LINK_ON_SHARED_CARDS`, `src/lib/share-card.ts`), both the image
    and the caption, on both the check-in and the rank card. Access is
    invite-only, so a posted card advertising a join link sends strangers at a
    door that will not open. Flip that one flag at ~20 testers; both cards light
    up together and tests cover both states.
17. **Startup & entry polish**, landing offers **Sign up** (primary) and **Log
    in** (secondary), both opening the same Privy OTP flow (it creates the
    account when the email is new). One branded `Splash` covers every pre-app
    wait, so startup reads as a single moment. `html` carries the linen ground +
    `color-scheme: light` (without it, dark-mode phones painted a black first
    frame and reloads flashed white). Home shows shimmer placeholders instead of
    fake zeros while the summary loads.
18. **Marketing site** (`ikigaro-os`), the Notion-backed waitlist is retired;
    every "Join the waitlist" CTA points at `app.ikigaro.com`, and the bottom
    email form is replaced by a signup button. `POST /api/waitlist` answers 410
    for stale cached pages. The landing snapshot's bootstrap **replaces the whole
    document** as it renders (it was silently destroying the edge-injected legal
    footer), so the Worker patches the rendered DOM via a persistent idempotent
    interval. The vestigial `src/` TanStack app was deleted (69 deps → 0).

19. **Iki ranks & the enamel badges**, five tiers off `iki_score`: Iki Rookie
    🌱 0 · Iki Apprentice 🛠️ 400 · Iki Pro ⚡ 2,000 · Iki Sensei 🥋 8,000 ·
    **Iki Grandmaster 🏆 25,000 (secret)**. Thresholds were fitted to modelled
    earn rates, not picked: a consistent user reaches Sensei in ~14 months.
    Grandmaster is withheld from the ladder, the progress bar **and** the "next
    rank" line, leaking it there once revealed both its name and its exact
    threshold to everyone one rung below.
    Artwork is Claude Design's "Iki Badges v3", cloisonné enamel pins with a
    hanko seal (芽 修 錬 師 道). One builder (`src/lib/rank-pin.ts`) feeds both
    the in-app SVG and the share canvas so they cannot drift. **Size picks the
    artwork**: full pin at 120px+, chip below that, because the scene turns to
    mud smaller. Gold `#D9B36A` is reserved for the Grandmaster pin and is used
    nowhere else in the product (there is a test).
    The rank card leads **Home**; the level-up toast fires on Check-in, where
    the earn happens.
20. **Accelerated Points (partner codes)**, a `partners` row (gym, community,
    brand, deliberately not a user) grants a boosted earn rate to everyone who
    signs up through its `?ref` code, on a glide path: 2.0x for 90 days, then
    1.5x for 90 more **if** the activity floor was met (45 check-ins), then
    1.25x steady. Plus a 150-point welcome grant, spendable only. The rate is
    snapshotted on the user's own row at signup, so deactivating a partner stops
    NEW joiners getting the deal without retroactively downgrading anyone
    already in. The floor is evaluated lazily on the first earn after day 90, no scheduled job to own or discover has been failing for a month.
    **Multipliers never touch `iki_score`**, so a community code cannot buy rank.
21. **Shareable rank card**, the same canvas pipeline as the check-in card
    (rendered client-side; nothing uploaded, no image service to run). One card,
    three formats (Story/Post/Square), no templates or field toggles: a check-in
    publishes several separable facts and some are nobody's business unless you
    say so, a rank is one public fact. Habit data only, the input type has
    nowhere to put a biomarker reading.

22. **Cloud wearable integrations**. Oura, Fitbit, Whoop, Withings, Garmin and
    Ultrahuman connect by OAuth from the web app. **No native app**: Apple
    HealthKit and Android Health Connect are on-device APIs with no web access
    at all, so they need one, these six do not, which is why they come first.
    The native path, when it comes, writes into the same
    `wearable_daily_metrics` table as one more provider.
    Six dialects normalize into one canonical vocabulary at the adapter boundary
    (`src/lib/wearables/metrics.ts`), so Whoop's "recovery" and Oura's
    "readiness" land on the same key rather than on two axes that quietly mean
    different things. Everything easy to get wrong, refresh, **rotation**,
    backoff, idempotent upsert, is shared in `sync.ts`.
    OAuth tokens are AES-GCM encrypted with a Worker secret
    (`WEARABLE_TOKEN_KEY`); a refresh token is standing permission to a third
    party's copy of someone's health data, and disk-level encryption does
    nothing against the realistic threat of a leaked service key. **Fails
    closed**, no key means no storage, never plaintext.
    Garmin is push-only (no on-demand fetch exists), so it has its own webhook,
    authenticated by a shared secret in the registered URL because Garmin does
    not sign its pushes. Garmin and Ultrahuman need approved applications with
    weeks of lead time. Setup: `docs/WEARABLES.md`, forms:
    `docs/WEARABLES_APPLICATIONS.md`.
    **Several devices merge into one series per metric** (`merge.ts`): a ranked
    source per metric, falling back PER DAY so the nights a ring was charging
    are filled by a watch instead of lost. Never averaged, that invents a
    number no device reported. Reasoning: `docs/WEARABLE_DATA.md`.
    Surfaced as "From your devices" in Trends, and measured sleep now replaces
    self-reported sleep in the Future You momentum model when a device has
    reported.
    NOT YET: no points for wearable data, steps are trivially spoofable and
    paying for them invites exactly that. The source ranking is not
    user-overridable, and there is no historical backfill on connect.

## 3. Key architecture decisions

- **Text-layer-first extraction**, thinking disabled, streaming keep-alive
  heartbeats, the model transcribes; `src/lib/biomarkers.ts` interprets
  deterministically. Human confirmation is the accuracy guard.
- **Reference data lives in the DB** (`biomarker_catalog`), ranges/bands
  update via migration, no code change (`docs/REFERENCE_DATA.md`).
- **Single sources of truth:** point values (`src/lib/points.ts`), "same
  report" identity (`panelContentSignature`, shared by points anti-farm and
  panel dedup), beta gate (`resolveApprovedUserId`).
- **Push architecture:** the app owns who-is-due and the payload copy; a
  separate `ikigaro-reminders` Worker owns scheduling and delivery. All sends
  are **at-most-once** (marked at hand-off), so backup/manual runs can never
  double-ping. Web Push crypto was assumed to be a poor Workers fit and lived in
  GitHub Actions; it turned out to be entirely doable on Web Crypto, and moving
  it removed GitHub from a core product loop.
- **Next 16 quirks:** `middleware` is deprecated → `proxy`, and proxy runs on
  the Node runtime which **OpenNext/Workers cannot run**, host-based redirects
  live in server components instead (see `(app)/admin/page.tsx`). Read
  `node_modules/next/dist/docs/` before assuming conventions.
- **Public build-time values are hardcoded defaults** (Supabase URL, Privy app
  ID, VAPID public key) because `NEXT_PUBLIC_*` inline at build time and were
  missing in CI.
- **Plaintext Worker vars must live in `wrangler.jsonc` `vars`**, `wrangler
  deploy` REPLACES dashboard-set vars every deploy (this wiped `ADMIN_EMAILS`
  once). Secrets via `wrangler secret put` persist.
- **Migration-first deploys, always**, code that reads a column before its
  migration runs takes the whole app down (the waitlist deploy briefly risked
  this). Merge is the *second* step.

## 4. Infrastructure, secrets & schedules

- **CI (`.github/workflows/ci.yml`):** lint → typecheck → unit tests → build on
  every PR and push. **Pull requests** then deploy to staging
  (`ai-tools-staging`, `--env staging`) and run the **Playwright E2E suite**
  against that deployment; **pushes to `main`** deploy to production
  (`npm run cf:deploy`). Repo secrets: `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`.
- **Production smoke (`smoke.yml`):** the same E2E suite against
  `app.ikigaro.com` every ~30 min + on demand. Exists because CI only tests
  staging, so production can break with every check green.
- **E2E (`docs/TESTING.md`):** read-only by design, no signup, no writes, so
  it is safe against any target. Covers the landing render (the white-screen
  class of bug), every API route rejecting anonymous callers, the admin gate,
  legal pages, and PWA assets. Authenticated flows remain hand-verified;
  Privy's email-OTP login needs a test mailbox to automate.
- **Staging (`docs/STAGING.md`, live since 2026-07-25):** `ai-tools-staging` at
  `ai-tools-staging.meetajinkyaj.workers.dev`, backed by the `ikigaro-staging`
  Supabase project (`albhabiyfaqvpnxilovf`) with its own Anthropic key. Shares
  the production Privy app, identity shared, data not; verified by a signup
  landing only in staging while production's user count stayed put. Separate
  Worker + separate Supabase project;
  `APP_ENV=staging` var. `assertNotProductionDatabase` refuses to boot if a
  non-production env would reach the production DB (the URL default falls back
  to prod, so a forgotten var would otherwise be silent). Build-time
  `NEXT_PUBLIC_APP_ENV=staging` renders the "Staging · not live data" badge.
  Single-slot: concurrent PRs overwrite (serialized by a CI concurrency group).
- **Reminders:** primary is the **`ikigaro-reminders` Worker**
  (`workers/reminders`, Cloudflare cron `30 12 * * *`, live at
  `ikigaro-reminders.meetajinkyaj.workers.dev`), deployed by CI alongside the
  app. Its secrets (`CRON_SECRET`, `VAPID_PRIVATE_KEY`) are per-Worker and
  inherit nothing. `.github/workflows/reminders.yml` remains as a late backup /
  break-glass manual sender.
- **Worker secrets:** `ANTHROPIC_API_KEY`, `PRIVY_APP_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (must equal the GH value).
- **Worker vars (committed):** `ADMIN_EMAILS` in `wrangler.jsonc`.
- **Cloudflare:** custom domain `admin.ikigaro.com` on the `ai-tools` worker;
  Cloudflare Access app on that hostname (email OTP, admin allow-list);
  **Bot Fight Mode OFF** (it 403'd our own cron caller; endpoints carry their
  own auth). Workers Builds git integration disconnected. CI is the only
  deploy path.
- **Schema:** `supabase/migrations/0001-0019` (idempotent; run on prod
  Supabase BEFORE merging code that depends on them). Seed template:
  `supabase/seed_redemption_catalog.sql`.
- **Marketing Worker:** `ikigaro-os` serves `public/index.html` + edge-injected
  legal footer and CTA retargeting. No secrets needed since the Notion waitlist
  was retired (`NOTION_API_KEY` can be deleted from that Worker).

## 5. Incident log & learnings

- CI didn't deploy → merged fixes never reached prod (added deploy job).
- White screen: empty `NEXT_PUBLIC_PRIVY_APP_ID` at CI build (hardcode publics).
- Extraction 502s: vision→text-layer; adaptive thinking→disabled; idle
  drop→streaming heartbeats. Save 500: `source` CHECK (map `pdf`→`pdf_upload`).
- Spurious trends: duplicate same-date panels (collapse to distinct dates), later fixed at the root with content-signature panel dedup.
- jsPDF dropped en-dashes (Latin-1) → `pdfText()` sanitizer.
- **Bot Fight Mode** served a managed challenge to the GH Actions cron → 403
  (turned BFM off; endpoints have real auth).
- **`ADMIN_EMAILS` wiped every deploy** (dashboard var vs wrangler `vars`) →
  pinned in `wrangler.jsonc`.
- **GitHub silently skipped a scheduled run** (no run at all on 2026-07-24) →
  idempotent sends + backup cron.
- **GitHub's scheduler then ran reminders 90-110 minutes late every day**
  (14:08/14:19/14:39 UTC against a 12:30 schedule) → 6 PM nudges arriving at
  7:40 PM. Moved scheduling *and* sending to a Cloudflare cron Worker; GitHub
  kept as a late backup, which is harmless because sends are at-most-once.
- **`window.confirm` can be suppressed by the browser** and then silently
  returns `true` → in-app `ConfirmDialog` for all destructive admin actions.
- Under-18 signup showed a generic error while Terms said 18+ and code said 13
  → aligned (now: no minimum, guardian-consent framing, per legal).
- **Privy allowed domains got REPLACED, not appended**, when the staging origin
  was added → `app.ikigaro.com` and `admin.ikigaro.com` both dropped out, Privy
  refused to initialize, and every user saw an endless startup splash for a day
  **with CI green** (CI only tests staging). Fixes: the add-never-replace rule
  in `STAGING.md` §1.5, and a **production smoke monitor** (`smoke.yml`, ~every
  30 min) so config-level breakage surfaces in minutes.
- **`redirect()` in a streaming Server Component does not emit an HTTP
  redirect**. Next inserts a client-side `NEXT_REDIRECT` instruction, so
  `app.ikigaro.com/admin` returned 200 to anything that doesn't run React. Moved
  to a `next.config.ts` host-scoped redirect (a real 307), asserted by E2E.
  (No admin UI was ever rendered on the app host; authorization never depended
  on this redirect.)
- **Investigated and dismissed:** `/offline.html` 307s to `/offline` (Cloudflare
  Assets drops `.html`), which looked like it would break the service worker's
  `cache.addAll` precache. Tested in a browser: `addAll` follows the redirect,
  caches under the original key, and `caches.match` finds it. Not a bug, noted
  so it isn't re-investigated.

- **A `CASE` expression in plpgsql resolves field references on BOTH arms.** A
  trigger shared between `users` and `partners` used `case when k='user' then
  new.referral_code else new.code end`, which failed with "record new has no
  field referral_code" on the partners side. An `IF` only evaluates the arm it
  takes. Caught by the collision test, not by review.
- **`points_transactions` stores redemptions as a POSITIVE amount with
  `type='redeem'`** (there is a `..._amount_pos` check constraint). Any backfill
  or roll-up that sums the ledger must filter `type = 'earn'`, or it inflates
  the total by everything users have spent.
- **Two tables created without RLS were readable AND writable by the anon key.**
  Migration 0013 added `partners` and `invite_codes` without `enable row level
  security`; every other table has had it since 0001. Supabase's dashboard
  warned at apply time and the warning was waved through on the reasoning that
  RLS-with-no-policies would break the app, it does not, because the service
  role bypasses RLS and every query here is server-side. Reproduced the hole on
  a local Postgres with the Supabase role setup (an anon `insert into partners`
  with `multiplier 5, welcome_grant 5000` succeeded), then closed it in 0014.
  **Rule: if a migration creates a table, the same migration enables RLS.**
- **Marcellus has no CJK.** Its only subsets are `latin` and `latin-ext`, so
  `生き甲斐` set in it renders purely from whatever Japanese face the device
  happens to have, fine on a Mac, tofu on Windows without the JP language pack.
  It rendered correctly in testing for exactly that reason, which is why the bug
  survived a visual check. `next/font/google` also offers **no Japanese subset
  for Noto Sans JP** (cyrillic/latin/latin-ext/vietnamese only). All Japanese
  glyphs in this product are therefore shipped as vector outlines
  (`ikigai-motif.ts`, `rank-kanji.ts`), which deletes the failure mode rather
  than guarding against it.
- **Render it before believing it.** Three defects this cycle survived code
  review and died instantly on a screenshot: the secret rank leaking its name
  and threshold into the "next rank" line, the ring tofu above, and a third of
  the Story-format share card left empty. Anything visual gets rasterised and
  looked at before it ships.
- **Verify PR and deploy state, never assert it.** Claimed a PR was open that
  had been merged, and separately reported a feature "not deployed" when the
  Cloudflare step was still mid-run. Both are one API call to check. Merge to
  live on this pipeline is roughly 5-8 minutes.

**Debugging order when something works locally but fails live:** (a) is it
actually deployed, (b) build-time env vars, (c) migration applied?, (d)
model-call latency/thinking defaults, (e) connection/idle timeouts, (f) DB
CHECK constraints, (g) Cloudflare zone features (Access/BFM) in the path.

## 6. Key files

| Area | File |
|---|---|
| Interpretation engine (flags, bands, units, derived) | `src/lib/biomarkers.ts` |
| Extraction prompt + normalization / Anthropic client | `src/lib/extraction.ts`, `src/lib/anthropic.ts` |
| Points economy (values + reasons + upload earns + signatures) | `src/lib/points.ts` |
| Trends/outcome rewards · Future You · analytics · reminders | `src/lib/trends.ts`, `future.ts`, `analytics.ts`, `reminders.ts` |
| Beta gate choke point / admin auth | `src/lib/app-user.ts`, `src/lib/admin-auth.ts` |
| Save route (dedup + awards) / extract route | `src/app/api/biomarkers/route.ts`, `…/extract/route.ts` |
| Cron due-reminders (daily + panel-day, idempotent) | `src/app/api/cron/due-reminders/route.ts` |
| Push sender (GH Actions) | `scripts/send-reminders.mjs`, `.github/workflows/reminders.yml` |
| Report / Trends / Future / Partners / Admin UIs | `src/app/biomarker-report.tsx`, `trends-view.tsx`, `future-view.tsx`, `partners-view.tsx`, `admin-view.tsx` |
| PWA (manifest, SW, install) / push client / telemetry | `src/app/manifest.ts`, `public/sw.js`, `install-prompt.tsx`, `push-client.ts`, `telemetry.tsx` |
| Waitlist / confirm dialog | `src/app/waitlist-screen.tsx`, `confirm-dialog.tsx` |
| Referrals (codes, milestone awards, invite API) | `src/lib/referral.ts`, `referral-award.ts`, `src/app/api/referral/route.ts` |
| **Crediting points (the ONLY place either balance is written)** | `src/lib/credit-points.ts` |
| Rank ladder / partners / accelerated multiplier | `src/lib/iki-rank.ts`, `partners.ts`, `accelerated-points.ts` |
| Badge artwork (one builder, app + share card) / kanji outlines | `src/lib/rank-pin.ts`, `rank-kanji.ts` |
| Rank card UI / rank share card | `src/app/rank-badge.tsx`, `rank-share-card.tsx`, `rank-card-render.ts`, `src/lib/rank-share-card.ts` |
| Admin partners API | `src/app/api/admin/partners/route.ts` |
| Wearables: metrics vocabulary, token crypto, adapters, sync | `src/lib/wearables/*` |
| Wearables API (connect, callback, sync cron, Garmin push) | `src/app/api/wearables/*`, `src/app/api/cron/sync-wearables/route.ts` |
| Device requests (suggest a device, admin tally) | `src/lib/device-requests.ts`, `src/app/device-suggest.tsx`, `src/app/admin-device-requests.tsx` |
| Email: Resend client, templates, socials | `src/lib/email.ts`, `src/lib/emails/*` |
| Announcements (compose, send, resume, unsubscribe) | `src/app/admin-broadcasts.tsx`, `src/app/api/admin/broadcasts/route.ts`, `src/app/api/email/unsubscribe/route.ts` |
| Landing / splash / startup states | `src/app/landing.tsx`, `ui.tsx` (`Splash`), `home-view.tsx`, `globals.css` |
| Schema | `supabase/migrations/0001-0019` |
| E2E suite / config | `e2e/*.spec.ts`, `playwright.config.ts`, `vitest.config.ts` |
| Docs | `docs/HANDOVER.md`, `RUNBOOK.md`, `STAGING.md`, `TESTING.md`, `REFERENCE_DATA.md`, `SCALING.md`, `FAQ.md`, `POINTS_ECONOMY.md`, `WEARABLES.md`, `WEARABLE_DATA.md`, `WEARABLES_APPLICATIONS.md`, `EMAIL.md`, `cowork/CURRENT.md` |

## 7. Operational recipes

- **Approve a beta tester:** admin console → Users → Approve (they tap "Check
  again", no re-login needed). Revoke reverses it (confirm dialog).
- **Add a voucher:** admin → Rewards → Add item (instruction/terms presets) →
  "Add codes" (paste one per line; duplicates skipped). Delete is safe: users'
  history keeps a name snapshot + code; unused codes are discarded.
- **Retune the economy:** edit `src/lib/points.ts` only.
- **Send an announcement:** admin -> Email. Write it, pick an audience, press
  "Send test to me" FIRST, then Send. The "Open Ikigaro" button is off unless
  you tick it. Sends are capped at 50 per run; anything
  left shows a Resume button. Unsubscribed, deleted and duplicate addresses are
  excluded automatically, and the count next to the audience is the real
  post-exclusion number.
- **See which wearable to build next:** admin -> Requests. Counts are distinct
  people, not submissions. Check it before chasing a vendor application.
- **Approving someone now emails them.** The console says which happened
  ("Approved, and emailed them" / "Approved, but the email failed"). It sends
  only on the waitlisted -> approved transition, so re-approving is silent.
  Full rules in [`EMAIL.md`](./EMAIL.md).
- **Update a reference range/band:** idempotent `UPDATE biomarker_catalog …`
  migration; no code change.
- **Set a Worker secret:** `npx wrangler secret put <NAME>`. **Set a plaintext
  var:** `wrangler.jsonc` `vars` (never the dashboard).
- **Test the reminder pipeline:** opt in on a device, don't check in, then
  Actions → "Daily reminders" → Run workflow; log shows `N check-in nudge(s),
  M re-test push(es)`.
- **Verification convention:** `eslint` + `npx tsc --noEmit` + `npm test` +
  `npm run build` + `npm run cf:build`. DB changes rehearsed on a throwaway
  Postgres (as `pguser`); live/browser + OTP steps via Cowork. Prod data is
  never mutated without an explicit ask.

## 8. Known follow-ups / deferred

- **Referral +150 panel tier**, verified by design + unit-level only (testing
  it live needs real blood data on a throwaway account, declined). It verifies
  organically: when the first referred beta tester uploads a panel, glance at
  the ledger for the `referral_panel` entry.
- **Family vault / multi-profile UI**, schema-ready since 0005; the add-on
  that serves under-18s via guardian accounts and aging-parent care.
- **Lawyer pass**, rewards terms (§14), eligibility wording (§1), privacy
  policy vs. DPDP; all drafted, flagged for counsel.
- **Personalized recommendation loop** (under Partners, NOT the Report):
  deterministic marker→intervention catalog the model presents; unmonetized
  food suggestions beside partner products; blocked on a real partner catalog.
- **Beta prep:** recruit 20-50 (India-first cohort), feedback channel; delete
  the leftover secrets file if not yet done; `+beta1` is the standing QA
  account.
- **E2E covers the signed-out surface only**, the authenticated critical path
  (onboarding → upload → confirm → check-in → redeem) is still hand-verified on
  staging. Automating it needs a test mailbox to read Privy OTPs; a test-only
  auth bypass was considered and rejected (`docs/TESTING.md`).
- **🔴 THERE ARE NO DATABASE BACKUPS, accepted risk, expires at ~20 testers.**
  Verified 2026-07-27, not assumed: the Supabase project is on the Free plan,
  which includes no backups and no PITR. If the database is lost, everything is
  lost, every user, panel, reading and points transaction, permanently.
  Founder's decision is to stay on Free while user count is single-digit and
  revisit at ~20 testers, which is a reasonable trade at this size. **That
  threshold is the whole safety margin**: past it, losing the data ends the
  beta rather than inconveniencing it. Fix is $25/mo (Supabase Pro → daily
  backups, 7-day retention). See `RUNBOOK.md` §2b.
- **Workout sync: NEXT UP, and the thesis is now written down.** `read:workout`
  is granted on Whoop and `Workout` on Oura; neither is requested in code yet.
  The founder's answer to "what is a workout for" is in
  [`WEARABLE_DATA.md`](./WEARABLE_DATA.md): the causal path is indirect and
  slow, training drives eating and recovery behaviour, which moves markers over
  a panel cycle of roughly six months, so the near-term job is **training load
  and recovery**, not a biomarker correlation nobody can yet demonstrate. Needs
  a `wearable_workouts` table and a migration, because a workout is a session
  and `wearable_daily_metrics` is one row per day per metric. Check-ins already
  carry `training_logged`, so the load and recovery signal can be built from
  data we hold today and gets sharper when device workouts arrive.
- **Oura sandbox check is WRITTEN, and needs running somewhere with network
  access.** `scripts/verify-oura-sandbox.mjs` calls
  `/v2/sandbox/usercollection/<collection>`, which returns deterministic sample
  data with no connected ring, and asserts that every field path the adapter
  reads is actually present. Every adapter here was written from documentation
  and four of four were wrong; this is the one vendor offering a way to catch
  that without owning the hardware. **The dev container's network policy denies
  `api.ouraring.com`**, so it exits 2 (inconclusive) there and has to run from a
  machine that can reach it, or the host has to be allowlisted. Once it can run
  in CI, an adapter that drifts from Oura's payload fails the build instead of
  silently dropping a metric.
- **Whoop AND Oura are both capped at 10 users until approved.** Two of the
  four self-serve providers, so this is the shape of the space rather than one
  vendor being awkward. Oura state it plainly: *"By default, API Applications
  have a ten user limit."* Their review is submitted from the application's own
  page, which is at least visible, unlike Whoop's. Ultrahuman has no such cap
  and is the only uncapped provider we can ship today, which is worth
  remembering when deciding which device to recommend to testers.
- **Whoop's approval in particular has no
  timeline.** From Whoop's own approval page: an app can be used for development
  immediately with a limit of 10 WHOOP members. Their community forum carries
  several developers reporting submissions from March onward with no approval,
  no rejection and no reply, one of them describing almost exactly our use case.
  Ten is enough for the closed beta and costs nothing, so Whoop is still worth
  having, but **no plan should assume the cap lifts.** Ultrahuman has no
  equivalent limit. Submit for approval as soon as the first real member
  connects, since Whoop require a completed test with one member before they
  will look at it and the queue only lengthens.
- **Disconnect does not revoke at the vendor.** It deletes our copy of the
  credentials, so we can never call the vendor again, but the authorisation the
  user granted still stands in their vendor account. Confirmed on production
  2026-08-04: a disconnect and reconnect went straight to the consent screen
  with no sign-in. That is correct OAuth and not a bug, and the dialog copy was
  fixed to stop promising a sign-in. Several vendors (Oura, Fitbit, Whoop)
  document a revoke endpoint and calling it on disconnect would be strictly
  better, both for the user's expectation of "disconnected" and for the data-use
  promise made on their application forms. Deferred rather than guessed at,
  because it is a different endpoint and payload per vendor and none of them is
  verified. Worth doing when there is a second provider live.
- **Garmin: deregistration and permission-change pushes are silently dropped.**
  A compliance gap, not a nicety: our handler reads only `dailies`, `sleeps`
  and `hrv`, so a user revoking consent at Garmin's end is acknowledged and
  ignored. Plan and blockers in [`GARMIN_AUDIT.md`](./GARMIN_AUDIT.md).
- **Garmin is out of the plan for now, at Garmin's end.** They replied
  2026-08-03 that they have "temporarily paused the review and approval of new
  API access requests" with no timeline. Nothing to resubmit and no queue
  position to hold. The adapter, push endpoint and
  [`GARMIN_AUDIT.md`](./GARMIN_AUDIT.md) all stay: none of it blocks anything,
  and the integration is written for whenever the queue reopens. **Recheck
  roughly quarterly**, by replying to the existing support thread.
- **Migration runner in CI** (`supabase db push` against prod on merge to
  `main`), replacing the current hand-application step. Migrations 0013-0019
  were each pasted into the Supabase SQL Editor by a human and verified with
  hand-written checks. That has worked without incident, but the failure mode
  showed itself on 0019: the editor's "Running..." spinner froze and never
  cleared, leaving it genuinely ambiguous whether the statement had committed,
  was still running, or was blocked on a lock. Re-clicking Run would have been
  the wrong move; it was resolved by probing the live database from a second
  connection. **The risk is not a bad migration, it is ambiguity about whether
  one ran.** A runner removes the step and the ambiguity together, and makes
  migrate-then-merge an ordering the pipeline enforces rather than one a person
  has to remember.
  _Needs:_ a service-role credential in CI, and a rollback story (forward-only
  fix-up migrations are probably the honest answer at this size).
  _Trigger:_ whenever a migration must run under time pressure, or a second
  person can deploy, or roughly when the backup decision expires at ~20
  testers, whichever comes first. Both become worth paying for at the same
  moment: when a mistake costs something real.
- **Scaling levers** (~10k users): OCR vendor, prompt caching, batch API,
  async queue, `docs/SCALING.md`.
- **Admin roll-ups aggregate in application memory**, `/api/admin/users`,
  `partnerStats()` and the analytics endpoint each pull whole tables and reduce
  them in JS. Correct at beta scale, wrong somewhere around 2-5k users;
  `daily_checkins` crosses first because it grows one row per user per day. The
  plan, and a cheaper pagination stopgap, are in `docs/SCALING.md`.
- **`healthkit_syncs` is dead schema.** Added in 0002, never written to, and
  superseded by `wearable_daily_metrics`, which the native path will also
  write into when it arrives. Left in place because dropping a table is a
  production migration for no benefit; drop it whenever the next migration
  touches that area. Do NOT build on it.
- **Rank thresholds are unvalidated against real behaviour.** They were fitted
  to a model of earn rates, not to observed users, because there are no observed
  users yet. Once ~20 testers have a month of history, check whether Apprentice
  really lands in week 2-4; that is the one that shapes first impressions.
- **Catalog range tuning** (BUN, Estradiol, Cortisol, MCV, MCH) via the
  migration path. Occasional HBsAg extraction miss, only touch if it recurs.
