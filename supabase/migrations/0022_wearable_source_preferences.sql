-- ---------------------------------------------------------------------------
-- 0022: which device a member wants us to believe.
--
-- THE PROBLEM THIS SOLVES. When two devices report the same night, something
-- has to decide what "your sleep on the 4th" was. `mergeMetrics` picks one per
-- metric per day by a ranked preference, never an average, because averaging
-- two devices produces a number neither reported and nobody can reconcile
-- against their own app. That ranking is ours, it is defensible, and it is
-- invisible: a member sees 6h50m on our screen, 7h12m in Whoop's app, and has
-- no way to tell a rule from a bug.
--
-- So the ranking becomes a default rather than a verdict. A member who trusts
-- their ring for sleep and their watch for steps can say so, once, and every
-- screen agrees with them afterwards.
--
-- PER FAMILY, NOT PER METRIC. Sleep, HRV, resting heart rate, readiness,
-- respiratory rate and blood oxygen all come off the same device on the same
-- night; asking somebody to choose a source for each of them separately is six
-- questions with one answer. The four families match the four rankings that
-- already existed in `merge.ts`: sleep, movement, body, glucose.
--
-- A PREFERENCE IS A PROMOTION, NOT A LOCK. The chosen provider sorts first;
-- everything else keeps its relative order behind it. So a night the preferred
-- device missed is still filled by the next best rather than left blank, which
-- is the entire reason to own two devices. Nothing here can cost a member data.
--
-- NO ROW IS WRITTEN AUTOMATICALLY. A member with one device needs no
-- preference: the merge already picks the only source there is. Writing a row
-- on connect would silently lock in a device chosen before there was anything
-- to choose between, and the member would never know a decision had been made
-- for them. Absent means automatic, and automatic is honest.
--
-- Idempotent, like every migration here. Safe to re-run.
-- ---------------------------------------------------------------------------

create table if not exists wearable_source_preferences (
  user_id    uuid not null references users(id) on delete cascade,

  -- One of the metric families in src/lib/wearables/merge.ts: sleep, movement,
  -- body, glucose. Free text rather than an enum for the same reason provider
  -- is: adding a family should be a code change, and an unrecognised value is
  -- inert at read time because the merge only looks up families it knows.
  family     text not null,

  -- A provider id. Not constrained to the current six, so retiring or adding a
  -- provider is not a migration. A preference naming a provider the member is
  -- no longer connected to simply never matches anything.
  provider   text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One answer per family per member. The upsert target, so changing a choice
  -- replaces it rather than accumulating a history nobody reads.
  primary key (user_id, family)
);

-- The read path is always "every preference for this one member", which the
-- primary key's leading column already serves. No second index.

-- ---------------------------------------------------------------------------
-- RLS. Enabled with NO policies, the convention since 0001: anon and
-- authenticated get nothing, the service role bypasses, and every query in this
-- app is server-side through createSupabaseAdmin(). Migration 0013 shipped two
-- tables without this and 0014 had to close it live; if a migration creates a
-- table, the same migration turns RLS on.
-- ---------------------------------------------------------------------------
alter table wearable_source_preferences enable row level security;

comment on table wearable_source_preferences is
  'Which device a member wants used for each metric family when more than one '
  'reports it. A promotion within the ranked fallback, never a lock: a day the '
  'preferred device missed is still filled by the next best. Absent means the '
  'default ranking in merge.ts applies.';
