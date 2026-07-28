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
  add column if not exists boost_floor_met     boolean;

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

create index if not exists users_iki_score_idx on users (iki_score desc);

create index if not exists users_accelerated_partner_idx
  on users (accelerated_partner)
  where accelerated_partner = true;

create index if not exists users_boost_started_idx
  on users (boost_started_at)
  where boost_started_at is not null;
