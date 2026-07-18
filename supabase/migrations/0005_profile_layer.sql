-- 0005: Profile layer — the family-vault foundation.
--
-- Health data has always hung off `user_id`. This migration inserts a Profile
-- BETWEEN the user and all health data: a user can have multiple profiles
-- (self, parent, spouse, child…), and every panel / reading / check-in / points
-- row now also carries `profile_id`. The multi-profile UI ships later, but doing
-- the schema now — while data is tiny — avoids a painful backfill migration on
-- production data. `user_id` is kept alongside `profile_id` (account-level
-- ownership + auth checks); `profile_id` is the health-ownership axis.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. profiles: allow multiple per user; add relationship + display_name.
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists relationship text not null default 'self',
  add column if not exists display_name text;

-- Existing single-profile-per-user rows are the user's "self" profile.
update profiles set display_name = full_name where display_name is null;

-- Drop the old one-profile-per-user unique; replace with one-*self*-per-user.
alter table profiles drop constraint if exists profiles_user_id_key;
create unique index if not exists profiles_one_self_per_user
  on profiles (user_id) where relationship = 'self';

alter table profiles drop constraint if exists profiles_relationship_check;
alter table profiles add constraint profiles_relationship_check
  check (relationship in ('self', 'parent', 'spouse', 'child', 'other'));

-- Safety net: every user must have exactly one self profile (backfill target).
insert into profiles (user_id, relationship)
select u.id, 'self'
from users u
where not exists (
  select 1 from profiles p where p.user_id = u.id and p.relationship = 'self'
);

-- ---------------------------------------------------------------------------
-- 2. Add profile_id to every health-owning table, backfill from the self
--    profile, then make it required. `user_id` stays.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'biomarker_panels', 'biomarker_readings', 'daily_checkins',
    'reward_points', 'points_transactions', 'redemption_transactions',
    'predictions', 'healthkit_syncs'
  ]
  loop
    execute format(
      'alter table %I add column if not exists profile_id uuid references profiles(id) on delete cascade',
      t);
    execute format(
      'update %I h set profile_id = p.id
         from profiles p
        where h.profile_id is null and p.user_id = h.user_id and p.relationship = ''self''',
      t);
    execute format('alter table %I alter column profile_id set not null', t);
    execute format(
      'create index if not exists %I on %I (profile_id)',
      t || '_profile_idx', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Move per-user uniqueness to per-profile (points balance, daily check-in).
-- ---------------------------------------------------------------------------
alter table reward_points drop constraint if exists reward_points_user_id_key;
create unique index if not exists reward_points_profile_key
  on reward_points (profile_id);

alter table daily_checkins drop constraint if exists daily_checkins_user_id_checkin_date_key;
create unique index if not exists daily_checkins_profile_date_key
  on daily_checkins (profile_id, checkin_date);
