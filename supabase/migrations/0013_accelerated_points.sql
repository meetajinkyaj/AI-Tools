-- 0013: Accelerated Points — partner codes that earn at a multiplier.
--
-- The growth deal: a community or brand gets a custom invite code, and anyone
-- who signs up through it earns points faster, so they reach a redeemable
-- voucher sooner. Codes already live on `users.referral_code` (0012), so a
-- "partner" is just a user row whose code carries a multiplier.
--
--   accelerated_partner   — on the CODE OWNER. Toggled from the admin console
--                           beside the vanity code. Governs what NEW signups
--                           through that code receive.
--   points_multiplier     — on the REFERRED USER. Snapshotted at signup, never
--                           re-read from the partner afterwards.
--   multiplier_expires_at — optional end date for a user's accelerated rate.
--   points_transactions.multiplier
--                         — what was applied to that specific earn.
--
-- WHY SNAPSHOT RATHER THAN LOOK UP LIVE. Reading the partner's flag at earn
-- time would make the rate retroactive in both directions: turning a partner
-- off would silently downgrade people who joined on the promise of 2x, and
-- turning one on would hand 2x to everyone who had ever used that code. A rate
-- offered at signup is a commitment, so it is stored on the person it was
-- offered to.
--
-- WHY THE LEDGER CARRIES THE MULTIPLIER. Without it a 20-point check-in next
-- to a 10-point one is unexplainable — to the user, to support, and to anyone
-- auditing the economy later. The column makes every row self-describing.
--
-- Idempotent.

alter table users
  add column if not exists accelerated_partner   boolean     not null default false,
  add column if not exists points_multiplier     numeric     not null default 1,
  add column if not exists multiplier_expires_at timestamptz;

-- A multiplier below 1 would quietly PENALISE a user, and an unbounded one is
-- a data-entry accident away from draining the voucher catalog. Neither should
-- be reachable, so the database refuses both.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_points_multiplier_check'
  ) then
    alter table users
      add constraint users_points_multiplier_check
      check (points_multiplier >= 1 and points_multiplier <= 5);
  end if;
end $$;

alter table points_transactions
  add column if not exists multiplier numeric not null default 1;

-- Partner codes are looked up by the admin console; there are very few of them.
create index if not exists users_accelerated_partner_idx
  on users (accelerated_partner)
  where accelerated_partner = true;

-- Accelerated users are counted for the partner analytics readout.
create index if not exists users_points_multiplier_idx
  on users (points_multiplier)
  where points_multiplier > 1;
