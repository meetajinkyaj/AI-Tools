-- Ikigaro — activities & per-activity check-in exercises
-- Run in the Supabase SQL Editor (or via the Supabase CLI) AFTER 0002.
--
-- Adds:
--   * profiles.activities        — the user's usual activity types (exercise
--     keys chosen at onboarding), used to pre-fill the daily check-in.
--   * daily_checkins.exercises   — what they actually did today, as a JSON list
--     of { type, label, duration } (duration = 'short' | 'medium' | 'long';
--     label is the free text for the "other" activity).
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS so it is safe to re-run.

alter table profiles
  add column if not exists activities text[] not null default '{}';

alter table daily_checkins
  add column if not exists exercises jsonb not null default '[]'::jsonb;
