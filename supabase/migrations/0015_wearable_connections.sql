-- 0015: Cloud wearable integrations — connections and normalized daily metrics.
--
-- THE POINT. Apple HealthKit and Android Health Connect are on-device APIs with
-- no web access at all, so reading them needs a native app. Six wearable
-- vendors — Oura, Fitbit, Whoop, Withings, Garmin, Ultrahuman — instead expose
-- server-to-server OAuth APIs, which the existing web app can talk to today.
-- This schema is the storage for that path. The native path, when it comes,
-- writes into the same `wearable_daily_metrics` table as one more provider.
--
-- TWO TABLES, ON PURPOSE:
--
--   wearable_connections    one row per (user, provider) — the OAuth grant.
--                           Holds credentials. Encrypted, see below.
--   wearable_daily_metrics  one row per (user, provider, date, metric) — the
--                           normalized data. Holds no credentials, and is safe
--                           to read widely inside the app.
--
-- Keeping them apart means the query that draws a sleep chart never touches a
-- table containing refresh tokens.
--
-- WHY TOKENS ARE ENCRYPTED AT THE APPLICATION LAYER. These are not health
-- readings, they are *credentials*: a refresh token is standing permission to
-- pull someone's sleep, heart rate and recovery from a third party, and it
-- keeps working until revoked. Postgres already encrypts at rest at the disk
-- level, which does nothing against the realistic threat here — a leaked
-- service-role key or a stray dump. Encrypting with a key that lives only in
-- the Worker's secrets means the database alone is not enough to impersonate
-- our users against six vendors. Losing the key costs everyone a reconnect,
-- which is recoverable; leaking the tokens is not.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- Connections
-- ---------------------------------------------------------------------------
create table if not exists wearable_connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  -- 'oura' | 'fitbit' | 'whoop' | 'withings' | 'garmin' | 'ultrahuman'
  provider          text not null,
  -- The vendor's own id for this user. Needed to route Garmin's push
  -- callbacks, which arrive keyed by their id and not ours.
  external_user_id  text,

  -- Ciphertext (AES-GCM, base64), never plaintext. See src/lib/wearables/crypto.ts.
  access_token_enc  text,
  refresh_token_enc text,
  expires_at        timestamptz,
  scopes            text,

  -- 'active'  — syncing normally
  -- 'expired' — refresh failed in a way the user must fix (re-consent)
  -- 'revoked' — user disconnected, kept for audit until purged
  status            text not null default 'active',
  last_sync_at      timestamptz,
  last_error        text,
  -- Consecutive failures. Backs off rather than hammering a vendor that is
  -- down, and marks a connection dead after enough of them.
  failure_count     integer not null default 0,

  connected_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint wearable_connections_status_check
    check (status in ('active', 'expired', 'revoked')),
  constraint wearable_connections_provider_check
    check (provider in ('oura', 'fitbit', 'whoop', 'withings', 'garmin', 'ultrahuman'))
);

-- One live connection per user per provider. Reconnecting updates in place, so
-- a user cannot accumulate stale grants that all keep syncing.
create unique index if not exists wearable_connections_user_provider_key
  on wearable_connections (user_id, provider);

-- Garmin pushes data keyed by ITS user id, not ours, so the webhook has to be
-- able to go the other way.
create index if not exists wearable_connections_external_idx
  on wearable_connections (provider, external_user_id)
  where external_user_id is not null;

-- The sync sweep's working set: active connections, oldest sync first.
create index if not exists wearable_connections_sync_idx
  on wearable_connections (status, last_sync_at)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Normalized daily metrics
--
-- Deliberately narrow (one row per metric per day) rather than a wide table
-- with a column per metric. Six vendors report overlapping but non-identical
-- sets, and every new device would otherwise be a migration. The cost is that
-- reads pivot in application code, which at one row per user per metric per day
-- is nothing.
--
-- `metric` vocabulary lives in src/lib/wearables/metrics.ts and is deliberately
-- NOT a CHECK constraint here: adding a metric should not need a migration, and
-- an unrecognised metric is inert data rather than a broken write.
-- ---------------------------------------------------------------------------
create table if not exists wearable_daily_metrics (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  provider     text not null,
  -- The DAY the metric describes, in the user's local terms as the vendor
  -- reported it. Not a timestamp: "how you slept on the 4th" is a day, and
  -- storing an instant invites timezone drift on every read.
  metric_date  date not null,
  metric       text not null,
  value        numeric not null,
  unit         text,
  -- Which device/app the vendor says produced it, when they tell us.
  source       text,
  recorded_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The idempotency key for the whole sync. Re-syncing a day overwrites rather
-- than duplicating, which is what makes a re-run safe and lets us re-pull a
-- window whenever a vendor backfills or corrects a night.
create unique index if not exists wearable_daily_metrics_key
  on wearable_daily_metrics (user_id, provider, metric_date, metric);

-- The read path: one user, one metric, recent days first.
create index if not exists wearable_daily_metrics_read_idx
  on wearable_daily_metrics (user_id, metric, metric_date desc);

-- ---------------------------------------------------------------------------
-- RLS. Enabled with no policies, the convention since 0001: anon and
-- authenticated get nothing, the service role bypasses, and every query in this
-- app is server-side through createSupabaseAdmin(). Migration 0013 shipped two
-- tables without this and 0014 existed only to fix it — hence doing it in the
-- same migration that creates the tables.
--
-- It matters more here than anywhere else in the schema: without it, the anon
-- key would read a table of live OAuth refresh tokens.
-- ---------------------------------------------------------------------------
alter table wearable_connections    enable row level security;
alter table wearable_daily_metrics  enable row level security;
