# Scaling Playbook. Lab-PDF → Biomarker Report

A quick-reference for optimizations we are **deliberately deferring** while the
product is early. Nothing here is needed for launch or the first thousands of
users. Each item lists *what it is*, *why we're skipping it now*, and *the rough
trigger* (user count or symptom) at which we should revisit.

> **Rule of thumb:** don't build any of this until the trigger fires. Premature
> optimization here means new PHI processors, new vendors, new failure modes,
> and real monthly cost, all before we know the real usage shape.

---

## Where we are today (the "walking skeleton")

The report pipeline as shipped:

1. **Upload** a lab PDF.
2. **Extract**, send the PDF to Claude directly (native PDF support). We try the
   text layer first; Claude's vision handles scanned/image pages as a fallback.
   No separate OCR vendor.
3. **Structure**. Claude returns markers normalized to our ~83-key catalog.
4. **Flag / band**, a *deterministic* engine (`src/lib/biomarkers.ts`) recomputes
   every flag, band, and derived marker. The model never decides "high/low"; it
   only reads values off the page.
5. **Confirm**, the user reviews/edits the extracted values before anything is
   saved. This human step is our primary accuracy guard.
6. **Save**, `POST /api/biomarkers`.

This is synchronous, single-model, no queue, no cache. It is correct and cheap
at low volume. Everything below is what we add *as volume grows*, in roughly the
order the pressure shows up.

---

## Deferred optimizations & their triggers

| # | Optimization | What it buys us | Rough trigger |
|---|--------------|-----------------|---------------|
| 1 | **Prompt caching** on the extraction system prompt + catalog | ~90% cheaper input tokens on the static part of every call; cheapest win, lowest risk | Turn on as soon as upload volume is steady (hundreds/day). Low effort, do this first. |
| 2 | **Async job + queue** for extraction | Moves the multi-second LLM call off the request path; survives Cloudflare Worker CPU/time limits; lets us retry | When uploads routinely exceed Worker CPU budget, or p95 upload latency hurts UX. ~1-5k active users. |
| 3 | **Dedicated OCR vendor** (Spike / Docupipe / Affinda / LLMWhisperer) for the *text-extraction* stage only | Higher fidelity on messy scans/multi-column labs; frees the LLM to do interpretation only | Only if we see extraction-accuracy complaints on scanned PDFs that Claude-vision fumbles. Re-evaluate ~10k users. Adds a new PHI sub-processor, needs a DPA + privacy-policy update. |
| 4 | **Cheaper / fine-tuned model** for the narrative/explanation text | Cuts per-report cost once the templated narrative isn't enough | When narratives graduate from templated to generated *and* volume makes the strong model's cost material. ~10k+ users. |
| 5 | **Cached explanation snippets** (per marker + flag state) | Most "what does high LDL mean" text is identical across users; serve from a table instead of regenerating | When generated narratives exist and repeat. Pairs with #4. |
| 6 | **Batch API (50% off)** for *non-real-time* work only | Half-price inference for anything that doesn't block a user (e.g. re-processing, trend backfills) | Only for background jobs. **Never** on the interactive confirm flow, batch latency breaks that UX. Whenever a background reprocessing need appears. |
| 7 | **RAG over medical references** for explanations | Grounded, citable explanation text | Deliberately premature today. Revisit only if/when explanations must cite sources (clinical sign-off era). Not volume-driven. |
| 8 | **PHI storage & retention policy** for raw PDFs | Decide what we keep vs. discard-after-extract; encryption-at-rest posture; retention window | Before we *store* raw PDFs at any scale. Cheapest posture now: extract → discard the file, keep only structured values. Formalize when legal/compliance work starts or a customer asks. |
| 9 | **Cost guardrails**, per-user upload rate limits, monthly spend alerts, model-cost dashboard | Protects against a runaway bill / abuse | Put a simple per-user rate limit in before any public/open signup. Spend alerting ~1k paying users. |

---

## Admin & roll-up queries, the other thing that will need moving

The scaling story above is about the lab-PDF pipeline. There is a second,
unrelated one: **several admin/roll-up endpoints pull whole tables and aggregate
in application memory.** That is the right call at beta scale (a handful of
users, one round trip, no SQL to maintain) and the wrong one somewhere north of
a few thousand.

| Endpoint | What it pulls | Trigger to move into SQL |
|---|---|---|
| `GET /api/admin/users` | All `users`, plus **all** `reward_points`, `biomarker_panels`, `daily_checkins`, and self `profiles` | ~2-5k users, or when the Users tab feels slow. `daily_checkins` grows fastest, it is one row per user per day, so it crosses first. |
| `partnerStats()` (`src/lib/partners.ts`) | All partner-cohort users, then their whole ledger + redemptions | A few thousand users **per partner** |
| `GET /api/admin/analytics` | Telemetry + check-in history for the funnel and retention windows | Same order; watch it alongside the roster |

**The shape of the fix** is the same in each case: a SQL aggregate (or a
materialized view refreshed on a schedule) returning one row per user or per
partner, instead of `select *` and a `Map`. None of it is urgent, none of it is
hard, and none of it should be built before the trigger fires, but the day the
admin console takes 10 seconds to load, this is why, and this table is the plan.

A cheaper stopgap that buys a lot of headroom: the roster already `.limit(1000)`
on `users` but not on the tables it joins against, so the joins are the real
cost. Paginating the roster and scoping the child queries to the visible page is
a much smaller change than moving to SQL, and worth doing first.

---

## Guardrails that stay true at every scale

These aren't optimizations, they're invariants we should not trade away for cost:

- **Flags are always recomputed deterministically.** The model reads numbers; our
  code decides high/low/band. This never moves to the LLM.
- **Human confirmation stays.** It is the accuracy backstop; keep it even after
  extraction gets better.
- **Normalize to our catalog keys, not LOINC.** LOINC is a later interop concern,
  not an extraction requirement.
- **Every value carries provenance**, was the range from the lab (`range_source:
  'lab'`) or our catalog (`'catalog'`). Keep this as sources multiply.
- **New extraction vendor = new PHI sub-processor.** Any of #3 above triggers a
  DPA and a privacy-policy update before it ships.

---

## Suggested order of adoption

1. Prompt caching (#1), trivial, immediate savings.
2. Async + queue (#2), the first real architectural change; unblocks scale.
3. Cost guardrails (#9), before opening signup wider.
4. Everything else (#3-#8), only when its specific trigger fires.

_Last updated: 2026-07-29. Revisit when we cross ~10k active users, add
generated (non-templated) narratives, or the admin console starts to drag._
