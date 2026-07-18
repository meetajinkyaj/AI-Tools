-- 0006: Capture-now fields — stop discarding data we can't reconstruct later.
--
-- Three additive changes, all "capture from day one or the data is gone":
--   1. biomarker_readings: keep the value + unit + reference range EXACTLY AS
--      PRINTED by the lab, alongside the canonical value we flag against. Today
--      we canonicalize on ingest (e.g. WBC 6870 -> 6.87) and drop the raw — which
--      blocks cross-lab normalization. Store both so normalization is backfillable.
--   2. intervention_log: what the user changed (started magnesium, began strength
--      training). Can't be reconstructed after the fact; powers attribution.
--   3. points_transactions: verification fields so an outcome-verified earn
--      ("HbA1c dropped 0.4 -> points") is representable before the rules engine.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. biomarker_readings: raw-as-printed provenance (nullable; `value`/`unit`
--    stay the canonical, flagged values).
-- ---------------------------------------------------------------------------
alter table biomarker_readings
  add column if not exists value_raw          numeric, -- value exactly as printed
  add column if not exists unit_raw           text,    -- unit exactly as printed
  add column if not exists lab_reference_low  numeric, -- the lab's printed range low
  add column if not exists lab_reference_high numeric; -- the lab's printed range high

-- ---------------------------------------------------------------------------
-- 2. intervention_log — what changed, for attribution.
-- ---------------------------------------------------------------------------
create table if not exists intervention_log (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  type         text not null, -- supplement | diet | training | medication | lifestyle | other
  label        text not null, -- e.g. "Magnesium glycinate", "Started strength training"
  dose_note    text,          -- free text, e.g. "400mg nightly"
  started_at   date not null default current_date,
  ended_at     date,          -- null = ongoing
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint intervention_log_type_check
    check (type in ('supplement', 'diet', 'training', 'medication', 'lifestyle', 'other'))
);

create index if not exists intervention_log_profile_idx on intervention_log (profile_id);

drop trigger if exists intervention_log_set_updated_at on intervention_log;
create trigger intervention_log_set_updated_at
  before update on intervention_log
  for each row execute function set_updated_at();

alter table intervention_log enable row level security;

-- ---------------------------------------------------------------------------
-- 3. points_transactions: outcome-verification metadata (nullable). `reason` is
--    free text, so 'outcome_bonus' needs no enum change.
-- ---------------------------------------------------------------------------
alter table points_transactions
  add column if not exists source_panel_id uuid references biomarker_panels(id) on delete set null,
  add column if not exists marker_key      text,
  add column if not exists delta_value     numeric,
  add column if not exists verified_at     timestamptz;
