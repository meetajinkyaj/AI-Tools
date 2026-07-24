-- 0012: Referrals — the last unwired earn in the points table.
--
--   referral_code — the user's own shareable code (generated lazily by the API
--                   on first request; unique, human-friendly charset).
--   referred_by   — who referred this user. Set ONCE, at account creation, from
--                   a ?ref link (never retro-attributed). The +150 referral earn
--                   is awarded to the referrer when this user completes
--                   onboarding (see POST /api/profile), not at signup.
--
-- Idempotent.

alter table users
  add column if not exists referral_code text,
  add column if not exists referred_by  uuid references users(id) on delete set null;

create unique index if not exists users_referral_code_key
  on users (referral_code)
  where referral_code is not null;

create index if not exists users_referred_by_idx
  on users (referred_by)
  where referred_by is not null;
