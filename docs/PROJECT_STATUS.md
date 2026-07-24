# Ikigaro — Project & Session Reference

_Last updated: 2026-07-26_

A living reference for the Ikigaro app: architecture, what's built, how to
operate it, and the known follow-ups. Update this as work lands.

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
  · Vitest (140+ tests) · Web Push (VAPID) sent from GitHub Actions.
- **Key non-sensitive IDs:** Worker name `ai-tools` · Cloudflare account
  `21510d84b951ec23fc0b34eb316e6546` · Privy app ID `cmr7snzr8003e0ejvn5y0sppr`
  (public; hardcoded default in `src/lib/privy-app-id.ts`) · VAPID public key
  (hardcoded in `src/lib/vapid-public-key.ts`).
- **Extraction model:** `claude-sonnet-5`, thinking **disabled**, overridable via
  env `ANTHROPIC_EXTRACTION_MODEL`. Key is a Worker secret `ANTHROPIC_API_KEY`.

## 2. What's built (all live)

1. **Baseline Biomarker Report** — PDF upload → text-layer extraction (`unpdf`,
   vision fallback) → Claude transcribes onto the ~83-marker catalog → human
   confirmation screen → deterministic flags/bands/derived markers/unit
   canonicalization on save. Report leads with "Worth a look" (incl. borderline);
   the full per-category breakdown is collapsed behind "See all N markers".
   Exact-duplicate re-saves return the existing panel (content-signature dedup).
2. **Profile layer** — every health row hangs off `profile_id`; one auto-created
   "self" profile per user today; multi-profile family vault is the planned
   add-on (also the compliant path for minors' data via guardian accounts).
3. **Daily check-ins** — energy/sleep/training/exercises, streaks, and the
   points economy. **Capture-now provenance**: raw-as-printed values + the
   lab's own printed ranges stored on every reading; intervention log.
4. **Trends** — leads with the daily check-in signal (panels are 6–12 months
   apart); biomarker deltas on distinct test dates; outcome-verified rewards
   (healthy-direction continued improvement, ≥14 days apart, capped).
5. **Points economy** — all values in `src/lib/points.ts` (single source of
   truth, trivially retunable). Earns: check-in 10, streaks 50/250, first panel
   200, re-test 150, outcome bonus 250/marker (max 3). Anti-farm: date guard +
   content-signature replay guard (same report never earns twice).
6. **Doctor-Ready PDF** — client-side jsPDF (lazy-loaded), Web Share API to
   WhatsApp/Telegram, Latin-1 glyph sanitizer.
7. **PWA** — installable (manifest + branded icons), conservative service
   worker (offline fallback only; no app/API caching), install prompt
   (Chromium button / iOS share-sheet hint).
8. **Daily reminders** — opt-in Web Push ("Daily reminders" toggle in
   Settings). Cron: GitHub Actions at 12:30 UTC (18:00 IST) + 13:05 backup;
   `/api/cron/due-reminders` (CRON_SECRET) returns who's due; sends are
   **idempotent per day** (`reminder_sent` events, at-most-once).
9. **Panel-day push** — once per panel cycle, when the ~6-month re-test window
   opens: "Your re-test window is open… earns +150 iki points". Same pipeline;
   `retest_reminder_sent` guard; replaces that day's check-in nudge.
10. **Future You** — habit momentum 0–100 (consistency/sleep/training/energy)
    leads; flagged markers get directional outlooks (`habit_v1`, no invented
    numbers) upgraded to clamped linear projections (`linear_v1`) with 2+ real
    test dates; re-test scoreboard card; active-interventions "running
    experiment" framing. Motivational, not diagnostic.
11. **Redemption marketplace (Partners tab)** — voucher items (points → instant
    code from a pre-loaded pool, atomic `redeem_voucher()` with SKIP LOCKED; no
    double-spend/double-issue) + affiliate items (free click-out, disclosure
    line, click logging). Copyable codes; collapsible redemption history that
    survives item deletion (name snapshot). How-to-redeem explainer + FAQ.
12. **Beta waitlist** — new signups land waitlisted (verified email via Privy
    OTP), see a branded waitlist screen, and are invisible to every data API
    (`resolveApprovedUserId` choke point). Admin approves/revokes from the
    console (audit-logged); waitlisted logins don't pollute DAU.
13. **Admin console** (`admin.ikigaro.com/admin`) — Analytics (default tab:
    funnel, D1/7/30 retention, DAU/WAU/MAU, streaks, 14-day check-in chart,
    client errors) · Rewards (add/delete items with instruction presets, bulk
    code upload, inventory) · Users (roster + approve/revoke). Destructive
    actions go through an in-app ConfirmDialog (never `window.confirm`).
    Auth: `ADMIN_EMAILS` allow-list (fail-closed) + Cloudflare Access;
    `app.ikigaro.com/admin` redirects to the admin subdomain.
14. **Observability** — `POST /api/telemetry`: `app_opened` beacon (approved
    users only, deduped/day → powers retention) + client error capture
    (window.onerror/unhandledrejection, pre-auth included, capped). Server
    errors: Cloudflare Workers observability.
15. **Age policy** — no minimum age (per legal review); under-18s use with
    parent/guardian consent (Terms §1); onboarding shows the consent note.
    Rewards/points terms live in Terms §14 (`/terms#rewards`, draft pending
    counsel's wording pass).
16. **Referrals** — name-based codes (`?ref=AJINKYA`; numbered on collision,
    random fallback, generated lazily) + admin-assigned vanity codes ("FITTR",
    inline editor in the Users tab with live normalize/preview). Attribution
    at signup only (`referred_by`); **tiered milestone earns** to the referrer
    via one shared `awardReferralMilestone` (at-most-once per milestone+friend,
    best-effort): +100 friend onboards (`referral`), +50 first 7-day streak
    (`referral_streak`), +150 first panel within 30 days (`referral_panel`) —
    max 300 (`REFERRAL_MAX_TOTAL`). Invite card (Share + Copy) on Partners;
    Terms §14 referral clause keeps values out of legal text.

## 3. Key architecture decisions

- **Text-layer-first extraction**, thinking disabled, streaming keep-alive
  heartbeats — the model transcribes; `src/lib/biomarkers.ts` interprets
  deterministically. Human confirmation is the accuracy guard.
- **Reference data lives in the DB** (`biomarker_catalog`) — ranges/bands
  update via migration, no code change (`docs/REFERENCE_DATA.md`).
- **Single sources of truth:** point values (`src/lib/points.ts`), "same
  report" identity (`panelContentSignature` — shared by points anti-farm and
  panel dedup), beta gate (`resolveApprovedUserId`).
- **Push architecture:** subscriptions + due-logic on the Worker; the actual
  web-push crypto runs in **GitHub Actions (Node)** — not a Workers fit. All
  sends are **at-most-once** (marked at hand-off), so backup/manual runs can
  never double-ping. GH cron is unreliable (silently skipped 2026-07-24) —
  hence the backup schedule.
- **Next 16 quirks:** `middleware` is deprecated → `proxy`, and proxy runs on
  the Node runtime which **OpenNext/Workers cannot run** — host-based redirects
  live in server components instead (see `(app)/admin/page.tsx`). Read
  `node_modules/next/dist/docs/` before assuming conventions.
- **Public build-time values are hardcoded defaults** (Supabase URL, Privy app
  ID, VAPID public key) because `NEXT_PUBLIC_*` inline at build time and were
  missing in CI.
- **Plaintext Worker vars must live in `wrangler.jsonc` `vars`** — `wrangler
  deploy` REPLACES dashboard-set vars every deploy (this wiped `ADMIN_EMAILS`
  once). Secrets via `wrangler secret put` persist.
- **Migration-first deploys, always** — code that reads a column before its
  migration runs takes the whole app down (the waitlist deploy briefly risked
  this). Merge is the *second* step.

## 4. Infrastructure, secrets & schedules

- **CI (`.github/workflows/ci.yml`):** push to `main` → lint → typecheck →
  test → build → deploy (`npm run cf:deploy`). Repo secrets:
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **Reminders (`.github/workflows/reminders.yml`):** cron 12:30 UTC + 13:05
  backup + manual dispatch → `scripts/send-reminders.mjs`. Repo secrets:
  `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
- **Worker secrets:** `ANTHROPIC_API_KEY`, `PRIVY_APP_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (must equal the GH value).
- **Worker vars (committed):** `ADMIN_EMAILS` in `wrangler.jsonc`.
- **Cloudflare:** custom domain `admin.ikigaro.com` on the `ai-tools` worker;
  Cloudflare Access app on that hostname (email OTP, admin allow-list);
  **Bot Fight Mode OFF** (it 403'd our own cron caller; endpoints carry their
  own auth). Workers Builds git integration disconnected — CI is the only
  deploy path.
- **Schema:** `supabase/migrations/0001–0011` (idempotent; run on prod
  Supabase BEFORE merging code that depends on them). Seed template:
  `supabase/seed_redemption_catalog.sql`.

## 5. Incident log & learnings

- CI didn't deploy → merged fixes never reached prod (added deploy job).
- White screen: empty `NEXT_PUBLIC_PRIVY_APP_ID` at CI build (hardcode publics).
- Extraction 502s: vision→text-layer; adaptive thinking→disabled; idle
  drop→streaming heartbeats. Save 500: `source` CHECK (map `pdf`→`pdf_upload`).
- Spurious trends: duplicate same-date panels (collapse to distinct dates) —
  later fixed at the root with content-signature panel dedup.
- jsPDF dropped en-dashes (Latin-1) → `pdfText()` sanitizer.
- **Bot Fight Mode** served a managed challenge to the GH Actions cron → 403
  (turned BFM off; endpoints have real auth).
- **`ADMIN_EMAILS` wiped every deploy** (dashboard var vs wrangler `vars`) →
  pinned in `wrangler.jsonc`.
- **GitHub silently skipped a scheduled run** (no run at all on 2026-07-24) →
  idempotent sends + backup cron.
- **`window.confirm` can be suppressed by the browser** and then silently
  returns `true` → in-app `ConfirmDialog` for all destructive admin actions.
- Under-18 signup showed a generic error while Terms said 18+ and code said 13
  → aligned (now: no minimum, guardian-consent framing, per legal).

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
| Schema | `supabase/migrations/0001–0011` |
| Docs | `docs/REFERENCE_DATA.md`, `docs/SCALING.md`, `docs/FAQ.md` |

## 7. Operational recipes

- **Approve a beta tester:** admin console → Users → Approve (they tap "Check
  again" — no re-login needed). Revoke reverses it (confirm dialog).
- **Add a voucher:** admin → Rewards → Add item (instruction/terms presets) →
  "Add codes" (paste one per line; duplicates skipped). Delete is safe: users'
  history keeps a name snapshot + code; unused codes are discarded.
- **Retune the economy:** edit `src/lib/points.ts` only.
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

- **Referral +150 panel tier** — verified by design + unit-level only (testing
  it live needs real blood data on a throwaway account — declined). It verifies
  organically: when the first referred beta tester uploads a panel, glance at
  the ledger for the `referral_panel` entry.
- **Family vault / multi-profile UI** — schema-ready since 0005; the add-on
  that serves under-18s via guardian accounts and aging-parent care.
- **Lawyer pass** — rewards terms (§14), eligibility wording (§1), privacy
  policy vs. DPDP; all drafted, flagged for counsel.
- **Personalized recommendation loop** (under Partners, NOT the Report):
  deterministic marker→intervention catalog the model presents; unmonetized
  food suggestions beside partner products; blocked on a real partner catalog.
- **Beta prep:** recruit 20–50 (India-first cohort), feedback channel; delete
  the leftover secrets file if not yet done; `+beta1` is the standing QA
  account.
- **Scaling levers** (~10k users): OCR vendor, prompt caching, batch API,
  async queue — `docs/SCALING.md`.
- **Catalog range tuning** (BUN, Estradiol, Cortisol, MCV, MCH) via the
  migration path. Occasional HBsAg extraction miss — only touch if it recurs.
