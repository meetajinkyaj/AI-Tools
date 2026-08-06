-- ---------------------------------------------------------------------------
-- 0020: workout sessions from wearables.
--
-- WHY A SEPARATE TABLE FROM wearable_daily_metrics. That table's grain is one
-- row per user per metric per day, which is exactly right for "how you slept on
-- the 4th" and exactly wrong for a workout. A workout is a SESSION: it starts,
-- it ends, it has a sport and an intensity, and several can happen in one day.
-- Forcing sessions into the daily table would mean either inventing a daily
-- aggregate nobody asked for, or hitting the same last-write-wins collision
-- that naps caused in two adapters (a 40 minute nap replacing a 7 hour night).
--
-- WHY WE STORE THESE AT ALL, since it is a fair question for an app built on
-- blood panels. The path from training to a marker is indirect and slow:
-- training drives eating and recovery behaviour, which moves markers over a
-- panel cycle of roughly six months. Load-bearing exercise also acts on bone,
-- muscle and gut, none of which a standard panel measures. The near-term use is
-- training load and recovery; the biomarker correlation is a research question
-- that needs paired training and panel data nobody has yet, and the only way to
-- have that data in a year is to start storing sessions now.
-- Reasoning in docs/WEARABLE_DATA.md.
--
-- VENDOR-NEUTRAL AND SPARSE ON PURPOSE. No vendor fills every column. Oura has
-- calories and no strain; Whoop has strain and kilojoules and no user label.
-- Everything past the four required columns is nullable, so a new provider is
-- an adapter change rather than a migration.
--
-- Idempotent, like every migration here. Safe to re-run.
-- ---------------------------------------------------------------------------

create table if not exists wearable_workouts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  provider      text not null,

  -- The vendor's own id for this session. Half of the idempotency key, so a
  -- re-sync of an overlapping window corrects rather than duplicates.
  external_id   text not null,

  started_at    timestamptz not null,
  ended_at      timestamptz not null,

  -- The DAY the session belongs to, denormalized from started_at in the
  -- vendor's local terms. Kept as its own column so a workout can be joined to
  -- wearable_daily_metrics without timezone arithmetic at read time, which is
  -- the whole point of pairing training against sleep and recovery.
  workout_date  date not null,

  -- Free text, deliberately. "running", "Weight Training", "padel": six vendors
  -- disagree about the taxonomy and a CHECK constraint here would make every
  -- new sport a migration. Normalizing is the adapters' job if it ever matters.
  activity      text,
  -- The vendor's own intensity label where they give one (Oura: easy, moderate,
  -- hard). Not comparable across vendors, and not to be charted as if it were.
  intensity     text,

  -- Whoop's 0-21 strain. NOT a percentage and NOT comparable to anything else
  -- here; it is one company's exertion model. Null for every other provider.
  strain        numeric,
  -- kcal. Whoop reports kilojoules and its adapter converts, so this column is
  -- one unit whoever wrote it.
  calories      numeric,
  distance_m    numeric,
  avg_heart_rate integer,
  max_heart_rate integer,

  -- Which device or app the vendor attributes the session to, when they say.
  source        text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The idempotency key. Re-syncing a window overwrites rather than duplicating,
-- which is what makes the overlapping nightly window safe and lets a vendor
-- revise a session's score after the fact.
create unique index if not exists wearable_workouts_key
  on wearable_workouts (user_id, provider, external_id);

-- The read path: one user's sessions, most recent first. Serves both the
-- training-load window and any future per-day pairing.
create index if not exists wearable_workouts_read_idx
  on wearable_workouts (user_id, workout_date desc);

-- ---------------------------------------------------------------------------
-- RLS. Enabled with NO policies, the convention since 0001: anon and
-- authenticated get nothing, the service role bypasses, and every query in this
-- app is server-side through createSupabaseAdmin(). Migration 0013 shipped two
-- tables without this and 0014 had to close it live; if a migration creates a
-- table, the same migration turns RLS on.
-- ---------------------------------------------------------------------------
alter table wearable_workouts enable row level security;
