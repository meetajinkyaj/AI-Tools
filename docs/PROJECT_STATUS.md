# Ikigaro — Project & Session Reference

_Last updated: 2026-07-18_

A living reference for the Ikigaro app: architecture, what's built, how to
operate it, and the known follow-ups. Update this as work lands.

## 1. Project snapshot

- **What it is:** Ikigaro, a longevity/health app. Users upload lab reports and
  log daily check-ins; the app extracts biomarkers, flags what's worth
  attention, and runs an iki-points loop.
- **Live:** app (`app.ikigaro.com`) · marketing (`www.ikigaro.com`)
- **Repos:** `meetajinkyaj/AI-Tools` (the app) · `ikigaro-os` (marketing site)
- **Stack:** Next.js (App Router) → **Cloudflare Workers via OpenNext** ·
  **Supabase Postgres** (RLS enabled, *no* policies; service-role key
  server-only) · **Privy** email-OTP auth (hand-rolled token verification via
  `crypto.subtle`, not the Privy SDK, so it runs on Workers) · Tailwind v4 ·
  Vitest.
- **Key non-sensitive IDs:** Worker name `ai-tools` · Cloudflare account
  `21510d84b951ec23fc0b34eb316e6546` · Privy app ID `cmr7snzr8003e0ejvn5y0sppr`
  (public; hardcoded default in `src/lib/privy-app-id.ts`).
- **Extraction model:** `claude-sonnet-5`, thinking **disabled**, overridable via
  env `ANTHROPIC_EXTRACTION_MODEL`. Key is a Worker secret `ANTHROPIC_API_KEY`.

## 2. What's built — Baseline Biomarker Report (end-to-end)

1. **PDF upload → AI extraction (no manual typing).** Upload a lab PDF → server
   extracts the **text layer** with `unpdf` (~0.7s for 40 pages) → sends text to
   Claude → model maps values onto the ~83-marker catalog. Vision fallback if a
   PDF has no text layer.
2. **Human confirmation.** Extracted values land on a "Check your results"
   screen (editable, removable) before anything saves — the accuracy guard.
3. **Deterministic interpretation.** On save, the server recomputes every
   flag/band/derived marker itself — the model only transcribes, never decides
   high/low.
4. **Severity-aware report.** Flags derive from interpretation **bands** (e.g.
   LDL 107.77 = soft "Near optimal", not a blunt "High"); status chip and
   callout always agree. Derived markers (Non-HDL, VLDL, ratios, eAG) computed
   from formulas.
5. **Correct units.** Raw cell counts (WBC 6870 /µL) are normalized to the
   catalog's canonical unit (→ 6.87, in range) so they don't false-flag.

Verified on a real 40-page FITTR PDF: 9/9 spot-check markers exact, correct
flags (Vit D low, Mg high, Testosterone low), derived values correct.

## 3. Key architecture decisions

- **Text-layer-first extraction**, not vision over every page — ~60× faster,
  avoids timeouts.
- **Model transcribes; code interprets.** Flags/bands/derived are deterministic
  in `src/lib/biomarkers.ts`. Human confirmation is the primary guard.
- **Thinking disabled for extraction** — it's transcription, not reasoning
  (Sonnet 5 otherwise runs adaptive thinking by default and blew the time
  budget).
- **Streaming keep-alive** — the extract route streams newline heartbeats during
  the ~20–30s model call so the browser connection never idles out.
- **Reference data lives in the DB** (`biomarker_catalog.ref_low/ref_high/
  bands`), read generically by the engine — ranges/bands update via a migration
  with **no app-code change**. See `docs/REFERENCE_DATA.md`.
- **Unit normalization is code** (`canonicalizeCount`, keyed to marker +
  magnitude, idempotent) — about parsing what a lab printed, not clinical
  thresholds.
- **Public build-time values are hardcoded defaults** (Supabase URL, Privy app
  ID) because `NEXT_PUBLIC_*` inline at build time and were missing in CI.

## 4. Infrastructure & deploy

- **CI (`.github/workflows/ci.yml`):** on push to `main`, runs lint → typecheck
  → test → build → **deploy** (`npm run cf:deploy`). Deploy gated on build
  passing. Requires repo secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit)
  + `CLOUDFLARE_ACCOUNT_ID`.
- **Single deploy path:** Cloudflare's own "Workers Builds" Git integration is
  **disconnected** — only the gated GitHub Actions job deploys.
- **Secrets:** Worker runtime secrets (`ANTHROPIC_API_KEY`, Privy/Supabase)
  persist across deploys.
- **To deploy:** merge to `main` (auto), or
  `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npm run cf:deploy` from a
  machine with access.

## 5. Incident log & learnings

The extraction feature took several rounds because of **environment/deploy
issues, not app logic**:

- Merged fixes weren't reaching the live app → **CI didn't deploy** (added the
  deploy job).
- App white-screened after first auto-deploy → **empty
  `NEXT_PUBLIC_PRIVY_APP_ID`** at CI build time (hardcoded a public default;
  rolled back the Worker to restore service first).
- Extraction 502'd at ~40s → **vision over 40 pages** timed out (switched to
  text-layer).
- Still 502'd at ~55s → **Sonnet 5 adaptive thinking** on by default (disabled).
- Browser `Failed to fetch` at ~30s despite a 200 → **idle-connection drop**
  (streaming keep-alive).
- Save 500'd → panel `source: "pdf"` violated a CHECK allowing only
  `pdf_upload` (mapped it).

**Debugging order when something works locally but fails live:** (a) is it
actually deployed, (b) build-time env vars, (c) model-call latency/thinking
defaults, (d) connection/idle timeouts, (e) DB CHECK constraints.

## 6. Key files

| Area | File |
|---|---|
| Interpretation engine (flags, bands, severity, units, derived) | `src/lib/biomarkers.ts` |
| Extraction prompt + response normalization | `src/lib/extraction.ts` |
| Anthropic client (stream, retry, thinking off) | `src/lib/anthropic.ts` |
| Extract route (text-layer, keep-alive stream) | `src/app/api/biomarkers/extract/route.ts` |
| Save route (flags/derived/units, source fix) | `src/app/api/biomarkers/route.ts` |
| Report UI (upload/confirm/report) | `src/app/biomarker-report.tsx` |
| Privy app ID default | `src/lib/privy-app-id.ts` |
| Schema | `supabase/migrations/0001–0004*.sql` |
| Docs | `docs/REFERENCE_DATA.md`, `docs/SCALING.md` |

## 7. Operational recipes

- **Update a reference range/band** (as research changes): write an idempotent
  `UPDATE biomarker_catalog SET bands = '…'::jsonb WHERE marker_key = '…'`
  migration. No code change. (HbA1c example in `docs/REFERENCE_DATA.md`.)
- **Add a count-unit marker to normalize:** add a row to `COUNT_SCALES` in
  `biomarkers.ts`.
- **Set a Worker secret:** `npx wrangler secret put <NAME>` on the `ai-tools`
  worker (persists across deploys; never commit values).
- **Verification convention:** `eslint` + `npx tsc --noEmit` + `npm test` +
  `npm run build` (+ `npm run cf:build` for the Worker bundle). DB changes
  verified against a throwaway Postgres; live/browser + OTP steps via Cowork.

## 8. Known follow-ups / deferred

- **Occasional HBsAg extraction miss** (worked last run) — only touch with a
  carefully-tested prompt nudge if it recurs; don't disturb the 9/9 numeric
  accuracy.
- **Catalog range tuning** — "12 of 81 to review" may include ranges worth a
  clinical review (BUN, Estradiol, Cortisol, MCV, MCH) via the migration path.
- **Scaling levers** (deferred to ~10k users): dedicated OCR vendor, prompt
  caching, batch API, async queue, cost guardrails — see `docs/SCALING.md`.
- **Next feature candidates:** Trends over time (recommended), HealthKit sync,
  Partners/redemption, Predictions.
- **Personalized recommendation loop (planned — lives under Partners, NOT the
  Report):** derive interventions from a user's flagged markers + trends (e.g.
  low magnesium → magnesium Partner products + magnesium-rich foods) and surface
  them as a personalized product list on the **Partners** tab, not as upsells
  inside the clinical Report. Design notes when we build it:
  - **Deterministic marker→intervention catalog**, not freeform LLM — a curated
    mapping (`low_magnesium → [product_keys], [foods]`) the model *presents*, so
    it can't hallucinate an unsafe suggestion. Add an `interventions` field to
    the biomarker catalog now so the data is ready when Partners onboard.
  - **Safety framing stays** "Educational, not a diagnosis"; conservative,
    doctor-deferring copy.
  - **Conflict-of-interest transparency:** show unmonetized food suggestions
    alongside the (monetized) Partner products so it reads as guidance, not an ad.
  - Blocked on the Partner catalog actually existing (still "coming soon").
