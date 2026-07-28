-- 0013: Split the currency, and add Accelerated Points on a glide path.
--
-- THE ARCHITECTURAL POINT. Until now one number did two incompatible jobs: it
-- was the redemption currency AND the implicit measure of how much someone had
-- done. Those pull in opposite directions — spending should reduce what you can
-- buy, but it must not reduce who you are, and a partner multiplier should let
-- you reach a voucher sooner without letting you buy status.
--
-- So there are two ledgers now:
--
--   reward_points.points_balance   spendable, boostable, falls on redemption
--   users.iki_score                lifetime, NEVER boosted, never spent
--
-- `iki_score` drives the rank ladder (Rookie → Apprentice → Pro → Sensei →
-- Grandmaster). Because it counts BASE amounts only, two people at the same
-- rank did the same amount of work, whether or not either came through a
-- partner code. A multiplier that touched it would let a community code buy
-- rank, and the ladder would stop meaning anything on the day it launched.
--
-- ACCELERATED POINTS, on a glide path rather than forever:
--
--   day 0–90    2.0x
--   day 91–180  1.5x if the activity floor was met in the first 90 days,
--               otherwise 1.25x
--   day 181+    1.25x steady state
--
--   boost_started_at  when the window opened (null = never a partner signup).
--                     Set once at signup, so switching a partner off later
--                     ends the deal for NEW joiners without retroactively
--                     downgrading anyone already in it.
--   boost_floor_met   evaluated lazily the first time an earn happens after
--                     day 90, then frozen. Null = not yet evaluated. Doing it
--                     lazily means no scheduled job to own, monitor, or
--                     discover has been silently failing for a month.
--
-- Idempotent.

alter table users
  -- Lifetime, unboosted, monotonic. The rank ladder reads this and nothing else.
  add column if not exists iki_score           bigint      not null default 0,
  -- On the CODE OWNER: does this user's referral_code grant acceleration?
  add column if not exists accelerated_partner boolean     not null default false,
  -- On the REFERRED USER: when their boost window opened.
  add column if not exists boost_started_at    timestamptz,
  add column if not exists boost_floor_met     boolean,
  -- Longest streak ever reached. Streak milestones pay once ever, keyed off
  -- this rather than off the current streak: the old rule fired whenever the
  -- streak EQUALLED 7 or 30, which paid people to break the habit the app
  -- exists to build (cycling 7-on/1-off beat a perfect year by 38%).
  add column if not exists best_streak         integer     not null default 0;

-- The ledger carries both numbers so a balance is always explainable and
-- iki_score is always rebuildable from first principles if it ever drifts.
alter table points_transactions
  add column if not exists base_amount integer,
  add column if not exists multiplier  numeric not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'points_txn_multiplier_check'
  ) then
    -- Below 1 would quietly PENALISE someone; unbounded is a data-entry
    -- accident away from draining the voucher catalog.
    alter table points_transactions
      add constraint points_txn_multiplier_check
      check (multiplier >= 1 and multiplier <= 5);
  end if;
end $$;

-- Existing rows predate the split: they were never boosted, so base == amount.
update points_transactions
   set base_amount = amount
 where base_amount is null;

-- Seed iki_score from the ledger that already exists, so nobody who has been
-- using the app since before ranks starts back at zero. Earns only — a
-- redemption spends the balance and must not reduce lifetime score.
with earned as (
  select user_id, sum(coalesce(base_amount, amount))::bigint as total
    from points_transactions
   where type = 'earn'
   group by user_id
)
update users u
   set iki_score = earned.total
  from earned
 where earned.user_id = u.id
   and u.iki_score = 0;

-- Seed best_streak from the check-in history, so nobody who has already built
-- a long streak has to rebuild it to collect the milestones they earned.
with peak as (
  select user_id, max(streak_count)::int as best
    from daily_checkins group by user_id
)
update users u
   set best_streak = peak.best
  from peak
 where peak.user_id = u.id
   and u.best_streak = 0;

create index if not exists users_iki_score_idx on users (iki_score desc);

create index if not exists users_accelerated_partner_idx
  on users (accelerated_partner)
  where accelerated_partner = true;

create index if not exists users_boost_started_idx
  on users (boost_started_at)
  where boost_started_at is not null;

-- ---------------------------------------------------------------------------
-- Partners — the entity behind an Accelerated Points code.
--
-- A partner is a gym, a community or a brand. It is NOT a user: there is no
-- account to hang the code on, and a partnership has its own name, terms and
-- start date. Modelling it as a flag on a user row worked for a single
-- influencer and falls over the moment you want to ask "who joined through
-- FITTR, and what did they cost us".
--
-- `users.referral_code` still exists and still means "this person invites
-- friends". Partner codes live here instead, and a ?ref code is resolved
-- against partners FIRST — see /api/auth/sync.
-- ---------------------------------------------------------------------------
create table if not exists partners (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  -- Normalised the same way user referral codes are (uppercase alnum).
  code           text not null,
  -- What a signup through this code earns during the boost window.
  multiplier     numeric not null default 2,
  -- "Endowed progress" — spendable, never counted toward rank.
  welcome_grant  integer not null default 150,
  active         boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  constraint partners_multiplier_check check (multiplier >= 1 and multiplier <= 5),
  constraint partners_welcome_check    check (welcome_grant >= 0 and welcome_grant <= 5000)
);

-- Codes must be unique among partners AND must not collide with a user's own
-- referral code, or a ?ref link would be ambiguous. Uniqueness within partners
-- is enforced here; the cross-table check lives in the admin route, which is
-- the only writer.
create unique index if not exists partners_code_key on partners (upper(code));

alter table users
  add column if not exists partner_id uuid references partners(id) on delete set null;

create index if not exists users_partner_id_idx
  on users (partner_id) where partner_id is not null;

-- ---------------------------------------------------------------------------
-- ONE code namespace, enforced by the database.
--
-- A ?ref link carries a single code and is resolved against partners first, so
-- a partner code and a user's invite code must never be the same string. Two
-- separate unique indexes cannot express that — and the gap was not
-- theoretical:
--
--   /api/referral generates a user's code from their NAME and retries on a
--   unique violation. It only ever knew about users.referral_code. With a
--   partner code "FITTR" already live, a user named Fittr would be assigned
--   FITTR, the users index would raise nothing, and from then on their invite
--   link would silently resolve to the partner — their referrals attributing
--   to someone else, permanently, with no error anywhere.
--
-- So both tables now write into one keyed table. The primary key does the
-- work: a colliding code fails the transaction that tried to take it. The
-- retry loop in /api/referral then does the right thing without knowing why,
-- because a unique violation is exactly what it already handles.
-- ---------------------------------------------------------------------------
create table if not exists invite_codes (
  code     text primary key,
  kind     text not null check (kind in ('user', 'partner')),
  owner_id uuid not null,
  unique (kind, owner_id)
);

create or replace function sync_invite_code() returns trigger
language plpgsql as $$
declare
  k        text := tg_argv[0];
  new_code text;
begin
  if tg_op = 'DELETE' then
    delete from invite_codes where kind = k and owner_id = old.id;
    return old;
  end if;

  -- Branch in plpgsql, NOT with a CASE expression: a CASE resolves field
  -- references on BOTH arms against the record, so `new.referral_code` would
  -- be evaluated for the partners trigger too and fail with "record new has no
  -- field referral_code". An IF only touches the arm it takes.
  if k = 'user' then
    new_code := upper(new.referral_code);
  else
    new_code := upper(new.code);
  end if;

  -- Delete-then-insert rather than upsert: an upsert on a code owned by
  -- someone else would silently do nothing, which is the failure we are here
  -- to prevent. A plain insert raises, and the transaction rolls back.
  delete from invite_codes where kind = k and owner_id = new.id;
  if new_code is not null then
    insert into invite_codes (code, kind, owner_id) values (new_code, k, new.id);
  end if;
  return new;
end $$;

drop trigger if exists users_invite_code_sync on users;
create trigger users_invite_code_sync
  after insert or update of referral_code or delete on users
  for each row execute function sync_invite_code('user');

drop trigger if exists partners_invite_code_sync on partners;
create trigger partners_invite_code_sync
  after insert or update of code or delete on partners
  for each row execute function sync_invite_code('partner');

-- Adopt the codes that already exist.
insert into invite_codes (code, kind, owner_id)
select upper(referral_code), 'user', id
  from users where referral_code is not null
on conflict (code) do nothing;
