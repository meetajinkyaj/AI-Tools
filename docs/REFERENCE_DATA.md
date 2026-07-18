# Reference data: ranges, bands, and units

How the biomarker report decides "is this value normal?" — and how to **update
that clinical logic over time without touching app code**. Reference ranges and
interpretation bands are **data in the database**, not constants in the app. The
interpretation engine (`src/lib/biomarkers.ts`) reads them generically, so
revising a threshold as medical guidance changes is a one-migration change.

## Where the data lives

Everything is on the `biomarker_catalog` table (see `supabase/migrations/`):

| Column | Meaning |
|---|---|
| `ref_low`, `ref_high` | The simple reference range. A value below `ref_low` flags **low**, above `ref_high` flags **high**, otherwise **in range**. Either can be null (one-sided, e.g. HDL has only a lower bound). |
| `sex` | `any` / `male` / `female`. Sex-specific rows override the `any` row for that marker (e.g. RBC, testosterone). |
| `direction` | `in_range` / `lower_better` / `higher_better` — presentation hint, not used for flagging. |
| `bands` | JSONB array of interpretation bands for markers that read as *bands* rather than a single range (LDL, HbA1c, Vitamin D, …). Optional; empty means "use ref_low/ref_high only". |

### Band shape

Each band is `{ "label", "low"?, "high"?, "severity" }`. Ranges are
**low-inclusive, high-exclusive** (`low ≤ value < high`); omit `low`/`high` for
an open end. `severity` is one of:

- `optimal` — the good band (shown neutral)
- `borderline` — between optimal and out-of-range (shown in a soft colour, still surfaced under "worth a look")
- `low` / `high` — clearly out of range (shown in the strong accent colour)

The band a value falls in **wins** over the raw ref-range flag, so the status
chip and the callout text always agree (a 107.77 LDL reads "Near optimal", not a
blunt "High").

## How to update a range or band (the whole point)

Write a new **idempotent** migration in `supabase/migrations/` with `UPDATE`
statements. No app change is needed — the engine picks up whatever's in the
table. Example — revising HbA1c to current ADA cut-points:

```sql
-- Non-diabetic <5.7, Prediabetes 5.7–6.4, Diabetes ≥6.5
update biomarker_catalog set bands =
  '[{"label":"Normal","high":5.7,"severity":"optimal"},
    {"label":"Prediabetes","low":5.7,"high":6.5,"severity":"borderline"},
    {"label":"Diabetes","low":6.5,"severity":"high"}]'::jsonb
where marker_key = 'hba1c';
```

To change a simple range instead:

```sql
update biomarker_catalog set ref_low = 40, ref_high = 60 where marker_key = 'hdl_c' and sex = 'any';
```

Guidelines:
- Keep migrations idempotent (`update ... where marker_key = ...` is naturally re-runnable).
- Bands are validated at read time, not write time — keep them contiguous and
  ordered, and make sure `severity` is one of the four values above.
- When a marker gains bands, no other change is required; when it loses them,
  set `bands = '[]'::jsonb` and it falls back to `ref_low`/`ref_high`.

## Units and cell-count normalization

Reference ranges assume the catalog's **canonical unit** for each marker (e.g.
WBC in `10^3/µL`). Some labs print raw cell counts (`6870 /µL`) instead, which
would otherwise flag a normal WBC as "high". `canonicalizeCount()` in
`src/lib/biomarkers.ts` scales these to the canonical unit by magnitude
(idempotent — an already-canonical value is untouched).

Currently normalized: **WBC**, **platelets** (`/µL → 10^3/µL`) and **RBC**
(`/µL → million/µL`). To add another count marker, add a row to `COUNT_SCALES`
with a `threshold` that sits safely between the canonical and raw magnitudes.
Unit scaling is code (not data) because it's about *parsing what a lab printed*,
not clinical thresholds — the thresholds themselves stay in the catalog.

## Disclaimer

None of this is a diagnosis. The report is educational and every screen carries:
*"Educational, not a diagnosis — please consult a doctor."*
