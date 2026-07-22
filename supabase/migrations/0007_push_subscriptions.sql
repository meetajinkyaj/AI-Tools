-- 0007: push_subscriptions — Web Push subscriptions for daily check-in reminders.
--
-- One row per browser/device that opted in. The reminder sender pushes to these
-- endpoints once a day (18:00 IST for the India-first beta) for users who have
-- not checked in yet. `timezone` is captured now (IANA name) so per-timezone
-- sending is a config change later, not a data re-collection.
--
-- Idempotent.

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  profile_id  uuid references profiles(id) on delete set null,
  endpoint    text not null,          -- the push service URL (unique per device)
  p256dh      text not null,          -- subscription public key (payload encryption)
  auth        text not null,          -- subscription auth secret
  timezone    text,                   -- IANA tz captured at opt-in (e.g. Asia/Kolkata)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One subscription per endpoint (re-subscribing the same device upserts).
create unique index if not exists push_subscriptions_endpoint_key
  on push_subscriptions (endpoint);
create index if not exists push_subscriptions_user_idx
  on push_subscriptions (user_id);

-- Keep updated_at fresh (set_updated_at() is defined in 0002).
drop trigger if exists push_subscriptions_set_updated_at on push_subscriptions;
create trigger push_subscriptions_set_updated_at
  before update on push_subscriptions
  for each row execute function set_updated_at();
