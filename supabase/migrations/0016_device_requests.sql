-- 0016: "Which device should we add next?", user-submitted device requests.
--
-- THE POINT. Six vendors are integrated, and every one of them was picked by us
-- guessing what people own. This table replaces the guess with a count. It is
-- the cheapest product research available: the users are already in the app,
-- already looking at the list of devices we support, and already noticing that
-- theirs is missing.
--
-- The immediate trigger was Fittr HART, a ring with real users in India, no
-- public API, and no HealthKit write, so we cannot integrate it however much we
-- want to. That is worth knowing as a number rather than as an anecdote: if
-- twenty people ask for a device we cannot reach, that is a case for going to
-- the vendor, and the demand has to be counted before it can be cited.
--
-- WHY TWO COLUMNS FOR ONE ANSWER. `raw_text` is exactly what the user typed;
-- `device_key` is that string folded onto a canonical name by
-- `src/lib/device-requests.ts`. Storing only the raw string gives a tally that
-- splits "oura", "Oura", "oura ring 4" into three rows and undercounts the one
-- device by a factor of three, the exact failure that makes a suggestion box
-- useless. Storing only the key throws away the evidence needed to notice a
-- fold is wrong, and to add the alias that fixes it. Both, or the data rots.
--
-- The normalisation lives in TypeScript rather than in a trigger so that it is
-- unit-testable and so that fixing an alias is a deploy, not a migration. Rows
-- keep the key computed at write time; a re-fold, if ever needed, is a one-off
-- backfill against the same function.

create table if not exists device_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,

  -- What they typed, verbatim. Never shown in the tally, always shown in the
  -- admin detail list, because it is the only way to see a bad fold.
  raw_text    text not null,

  -- The canonical bucket. Counting happens on this.
  device_key  text not null,

  -- "Tell me when this is added." A standing opt-in to one email, on the day
  -- the device goes live. Not marketing consent for anything else.
  notify      boolean not null default false,

  -- Set when that email actually goes out, so a later launch cannot mail the
  -- same person about the same device twice.
  notified_at timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ONE ROW PER PERSON PER DEVICE. Without this, one enthusiastic user submitting
-- "Oura" five times reads as five people wanting Oura, and the tally, whose
-- entire job is to say how many people want a thing, lies. The write path
-- upserts onto this, so re-submitting updates rather than duplicates.
create unique index if not exists device_requests_user_device
  on device_requests (user_id, device_key);

-- The tally groups by device_key; the launch mailout selects by device_key and
-- notify. Both are this index.
create index if not exists device_requests_device
  on device_requests (device_key);

create index if not exists device_requests_created
  on device_requests (created_at desc);

-- RLS on, no policies: deny-all for anon and authenticated, service role
-- bypasses. Every read and write here goes through a server route that has
-- already checked the caller. Same posture as every other table in this schema
--, see 0014 for what happens when a table is added without it.
alter table device_requests enable row level security;
