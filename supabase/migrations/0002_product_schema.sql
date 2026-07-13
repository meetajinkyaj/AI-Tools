-- Ikigaro product schema — Phase 0 data model
-- Run in the Supabase SQL Editor (or via the Supabase CLI) AFTER 0001.
--
-- Adds the core product entities every MVP feature depends on: biomarker
-- panels & readings, the marker catalog (taxonomy + reference ranges), daily
-- check-ins, the iki-points economy (balance + append-only ledger), the
-- redemption marketplace, and "Future You" predictions. HealthKit sync is
-- defined but stays unused until the Phase 2 native app.
--
-- Auth/RLS model is identical to 0001: Privy authenticates, the server uses
-- the SERVICE ROLE key, and every table has RLS enabled with NO policies so
-- the anon/public key can read nothing.
--
-- Conventions match 0001: uuid PKs, timestamptz created_at/updated_at, the
-- shared set_updated_at() trigger, and text columns (allowed values noted in
-- comments) with lightweight CHECK constraints on true enums for integrity.

-- ===========================================================================
-- Biomarker catalog — the fixed marker taxonomy + reference ranges.
-- ===========================================================================
-- IMPORTANT (clinical safety): the reference ranges seeded below are common,
-- widely-cited ADULT intervals in conventional US units, provided only to
-- bootstrap the schema. They are NOT clinically validated, vary by lab /
-- assay / age / sex / population, and MUST be reviewed and signed off by a
-- qualified professional (and localized per partner lab) before production
-- use. Every seeded row is marked is_validated = false to make that explicit.
create table if not exists biomarker_catalog (
  id             uuid primary key default gen_random_uuid(),
  marker_key     text not null,          -- canonical id, e.g. 'ldl_c'
  display_name   text not null,          -- e.g. 'LDL Cholesterol'
  category       text not null,          -- 'lipids' | 'metabolic' | 'inflammation' | ...
  unit           text not null,          -- e.g. 'mg/dL'
  sex            text not null default 'any',  -- 'any' | 'male' | 'female'
  ref_low        numeric,                -- lower bound of the reference range (nullable)
  ref_high       numeric,                -- upper bound of the reference range (nullable)
  direction      text not null default 'in_range', -- 'in_range' | 'lower_better' | 'higher_better'
  is_validated   boolean not null default false,   -- clinician sign-off flag
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint biomarker_catalog_sex_check check (sex in ('any', 'male', 'female')),
  constraint biomarker_catalog_direction_check
    check (direction in ('in_range', 'lower_better', 'higher_better')),
  unique (marker_key, sex)
);

create index if not exists biomarker_catalog_category_idx
  on biomarker_catalog (category, sort_order);

create trigger biomarker_catalog_set_updated_at
  before update on biomarker_catalog
  for each row execute function set_updated_at();

-- ===========================================================================
-- Biomarker panels — one lab draw / upload event per row.
-- ===========================================================================
create table if not exists biomarker_panels (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  source        text not null default 'manual', -- 'manual' | 'pdf_upload' | 'lab_api'
  test_date     date,                            -- date the sample was taken
  lab_name      text,
  raw_file_url  text,                            -- storage path to the uploaded PDF, if any
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint biomarker_panels_source_check
    check (source in ('manual', 'pdf_upload', 'lab_api'))
);

create index if not exists biomarker_panels_user_date_idx
  on biomarker_panels (user_id, test_date desc);

create trigger biomarker_panels_set_updated_at
  before update on biomarker_panels
  for each row execute function set_updated_at();

-- ===========================================================================
-- Biomarker readings — individual marker values within a panel.
-- user_id is denormalized from the panel for simpler per-user queries/indexing.
-- flag is computed against the catalog range at write time and stored.
-- ===========================================================================
create table if not exists biomarker_readings (
  id                   uuid primary key default gen_random_uuid(),
  panel_id             uuid not null references biomarker_panels(id) on delete cascade,
  user_id              uuid not null references users(id) on delete cascade,
  marker_key           text not null,        -- joins to biomarker_catalog.marker_key
  marker_name          text not null,        -- snapshot of the display name at entry
  value                numeric not null,
  unit                 text,
  reference_range_low  numeric,              -- snapshot of the range used (nullable)
  reference_range_high numeric,
  flag                 text not null default 'unknown', -- 'in_range' | 'low' | 'high' | 'unknown'
  created_at           timestamptz not null default now(),
  constraint biomarker_readings_flag_check
    check (flag in ('in_range', 'low', 'high', 'unknown'))
);

create index if not exists biomarker_readings_panel_idx
  on biomarker_readings (panel_id);
create index if not exists biomarker_readings_user_marker_idx
  on biomarker_readings (user_id, marker_key);

-- ===========================================================================
-- Daily check-ins — the 30-second retention loop. One row per user per day.
-- ===========================================================================
create table if not exists daily_checkins (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  checkin_date    date not null default current_date,
  sleep_hours     numeric,                 -- e.g. 7.5
  energy_score    integer,                 -- 1..5
  training_logged boolean not null default false,
  nutrition_note  text,
  streak_count    integer not null default 0, -- snapshot of the streak at check-in
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint daily_checkins_energy_check
    check (energy_score is null or energy_score between 1 and 5),
  unique (user_id, checkin_date)
);

create index if not exists daily_checkins_user_date_idx
  on daily_checkins (user_id, checkin_date desc);

create trigger daily_checkins_set_updated_at
  before update on daily_checkins
  for each row execute function set_updated_at();

-- ===========================================================================
-- Reward points — the current iki-points balance. One row per user.
-- The append-only ledger lives in points_transactions; this row is the
-- running total (kept in sync by the server when writing a transaction).
-- ===========================================================================
create table if not exists reward_points (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  points_balance integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint reward_points_balance_nonneg check (points_balance >= 0),
  unique (user_id)
);

create trigger reward_points_set_updated_at
  before update on reward_points
  for each row execute function set_updated_at();

-- ===========================================================================
-- Points transactions — the append-only iki-points ledger.
-- amount is always positive; `type` says whether it added or removed points.
-- reference_id links to the thing that caused it (a check-in, panel,
-- redemption, referral), interpreted per `reason`.
-- ===========================================================================
create table if not exists points_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  type         text not null,   -- 'earn' | 'redeem'
  amount       integer not null,-- positive magnitude of points moved
  reason       text not null,   -- 'checkin' | 'streak_bonus' | 'panel_upload' | 'referral' | 'redemption' | 'adjustment'
  reference_id uuid,            -- optional FK-by-convention to the source row
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  constraint points_transactions_type_check check (type in ('earn', 'redeem')),
  constraint points_transactions_amount_pos check (amount > 0)
);

create index if not exists points_transactions_user_created_idx
  on points_transactions (user_id, created_at desc);

-- ===========================================================================
-- Redemption catalog — marketplace items (server/admin-managed, not user-scoped).
-- ===========================================================================
create table if not exists redemption_items (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  partner          text,
  description      text,
  category         text,
  points_cost      integer not null,
  discount_value   text,            -- human-readable, e.g. '20% off' or '$25'
  inventory_status text not null default 'in_stock', -- 'in_stock' | 'out_of_stock' | 'coming_soon'
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint redemption_items_cost_pos check (points_cost >= 0),
  constraint redemption_items_inventory_check
    check (inventory_status in ('in_stock', 'out_of_stock', 'coming_soon'))
);

create index if not exists redemption_items_status_idx
  on redemption_items (inventory_status, category);

create trigger redemption_items_set_updated_at
  before update on redemption_items
  for each row execute function set_updated_at();

-- ===========================================================================
-- Redemption transactions — a user spending points on a catalog item.
-- ===========================================================================
create table if not exists redemption_transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  item_id       uuid not null references redemption_items(id) on delete restrict,
  points_spent  integer not null,
  status        text not null default 'pending', -- 'pending' | 'fulfilled' | 'cancelled'
  discount_code text,             -- issued on fulfillment
  redeemed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint redemption_transactions_points_pos check (points_spent >= 0),
  constraint redemption_transactions_status_check
    check (status in ('pending', 'fulfilled', 'cancelled'))
);

create index if not exists redemption_transactions_user_idx
  on redemption_transactions (user_id, created_at desc);

create trigger redemption_transactions_set_updated_at
  before update on redemption_transactions
  for each row execute function set_updated_at();

-- ===========================================================================
-- Predictions — "Future You" directional projections per marker.
-- v1 is a simple linear extrapolation; model_version records how it was made.
-- ===========================================================================
create table if not exists predictions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  marker_key      text not null,
  marker_name     text not null,
  current_value   numeric,
  projected_value numeric,
  projection_date date,             -- the date the projection targets
  model_version   text not null default 'linear_v1',
  generated_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists predictions_user_marker_idx
  on predictions (user_id, marker_key, generated_at desc);

-- ===========================================================================
-- HealthKit / Health Connect sync — DEFINED NOW, UNUSED until the Phase 2
-- native app. Kept here so Phase 0 is complete and the entity is not lost.
-- ===========================================================================
create table if not exists healthkit_syncs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  data_type     text not null,   -- 'steps' | 'hrv' | 'sleep' | 'heart_rate'
  value         numeric,
  recorded_at   timestamptz,
  source_device text,
  created_at    timestamptz not null default now()
);

create index if not exists healthkit_syncs_user_type_idx
  on healthkit_syncs (user_id, data_type, recorded_at desc);

-- ===========================================================================
-- Seed the marker taxonomy (~30 common markers). See the clinical-safety note
-- on biomarker_catalog above: these ranges are provisional and unvalidated.
-- ===========================================================================
insert into biomarker_catalog
  (marker_key, display_name, category, unit, sex, ref_low, ref_high, direction, sort_order)
values
  -- Lipids
  ('total_cholesterol', 'Total Cholesterol', 'lipids', 'mg/dL', 'any', 125, 200, 'lower_better', 10),
  ('ldl_c',             'LDL Cholesterol',   'lipids', 'mg/dL', 'any', 0,   100, 'lower_better', 11),
  ('hdl_c',             'HDL Cholesterol',   'lipids', 'mg/dL', 'male', 40, null, 'higher_better', 12),
  ('hdl_c',             'HDL Cholesterol',   'lipids', 'mg/dL', 'female', 50, null, 'higher_better', 13),
  ('triglycerides',     'Triglycerides',     'lipids', 'mg/dL', 'any', 0,   150, 'lower_better', 14),
  -- Metabolic
  ('glucose_fasting',   'Fasting Glucose',   'metabolic', 'mg/dL', 'any', 70, 99, 'in_range', 20),
  ('hba1c',             'HbA1c',             'metabolic', '%',     'any', 4.0, 5.6, 'lower_better', 21),
  ('insulin_fasting',   'Fasting Insulin',   'metabolic', 'uIU/mL','any', 2,  25, 'lower_better', 22),
  -- Inflammation
  ('hs_crp',            'hs-CRP',            'inflammation', 'mg/L', 'any', 0, 3.0, 'lower_better', 30),
  ('homocysteine',      'Homocysteine',      'inflammation', 'umol/L', 'any', 0, 15, 'lower_better', 31),
  -- Hematology
  ('hemoglobin',        'Hemoglobin',        'hematology', 'g/dL', 'male', 13.5, 17.5, 'in_range', 40),
  ('hemoglobin',        'Hemoglobin',        'hematology', 'g/dL', 'female', 12.0, 15.5, 'in_range', 41),
  ('hematocrit',        'Hematocrit',        'hematology', '%',    'male', 38.8, 50.0, 'in_range', 42),
  ('hematocrit',        'Hematocrit',        'hematology', '%',    'female', 34.9, 44.5, 'in_range', 43),
  ('wbc',               'White Blood Cells', 'hematology', '10^3/uL', 'any', 3.4, 10.8, 'in_range', 44),
  ('platelets',         'Platelets',         'hematology', '10^3/uL', 'any', 150, 450, 'in_range', 45),
  ('ferritin',          'Ferritin',          'hematology', 'ng/mL', 'male', 30, 400, 'in_range', 46),
  ('ferritin',          'Ferritin',          'hematology', 'ng/mL', 'female', 15, 150, 'in_range', 47),
  -- Thyroid
  ('tsh',               'TSH',               'thyroid', 'mIU/L', 'any', 0.4, 4.0, 'in_range', 50),
  ('free_t4',           'Free T4',           'thyroid', 'ng/dL', 'any', 0.8, 1.8, 'in_range', 51),
  ('free_t3',           'Free T3',           'thyroid', 'pg/mL', 'any', 2.3, 4.2, 'in_range', 52),
  -- Hormones
  ('testosterone_total','Total Testosterone','hormones', 'ng/dL', 'male', 300, 1000, 'in_range', 60),
  ('testosterone_total','Total Testosterone','hormones', 'ng/dL', 'female', 15, 70, 'in_range', 61),
  ('vitamin_d_25oh',    'Vitamin D (25-OH)', 'nutrients', 'ng/mL', 'any', 30, 100, 'higher_better', 70),
  ('vitamin_b12',       'Vitamin B12',       'nutrients', 'pg/mL', 'any', 200, 900, 'in_range', 71),
  ('folate',            'Folate',            'nutrients', 'ng/mL', 'any', 3.0, 20, 'higher_better', 72),
  ('magnesium',         'Magnesium',         'nutrients', 'mg/dL', 'any', 1.7, 2.2, 'in_range', 73),
  -- Liver
  ('alt',               'ALT',               'liver', 'U/L', 'any', 7, 55, 'in_range', 80),
  ('ast',               'AST',               'liver', 'U/L', 'any', 8, 48, 'in_range', 81),
  ('ggt',               'GGT',               'liver', 'U/L', 'any', 5, 61, 'lower_better', 82),
  ('albumin',           'Albumin',           'liver', 'g/dL', 'any', 3.5, 5.0, 'in_range', 83),
  ('bilirubin_total',   'Total Bilirubin',   'liver', 'mg/dL', 'any', 0.1, 1.2, 'in_range', 84),
  -- Kidney
  ('creatinine',        'Creatinine',        'kidney', 'mg/dL', 'any', 0.6, 1.3, 'in_range', 90),
  ('egfr',              'eGFR',              'kidney', 'mL/min/1.73m2', 'any', 60, 120, 'higher_better', 91),
  ('bun',               'BUN',               'kidney', 'mg/dL', 'any', 7, 20, 'in_range', 92),
  ('uric_acid',         'Uric Acid',         'kidney', 'mg/dL', 'any', 2.4, 7.0, 'lower_better', 93),
  ('sodium',            'Sodium',            'kidney', 'mmol/L', 'any', 135, 145, 'in_range', 94),
  ('potassium',         'Potassium',         'kidney', 'mmol/L', 'any', 3.5, 5.1, 'in_range', 95)
on conflict (marker_key, sex) do nothing;

-- ===========================================================================
-- Row Level Security: enable everywhere, add NO policies (same as 0001).
-- ===========================================================================
alter table biomarker_catalog        enable row level security;
alter table biomarker_panels         enable row level security;
alter table biomarker_readings       enable row level security;
alter table daily_checkins           enable row level security;
alter table reward_points            enable row level security;
alter table points_transactions      enable row level security;
alter table redemption_items         enable row level security;
alter table redemption_transactions  enable row level security;
alter table predictions              enable row level security;
alter table healthkit_syncs          enable row level security;
