-- Ikigaro core schema — initial migration
-- Run in the Supabase SQL Editor (or via the Supabase CLI).
--
-- Auth model: Privy handles authentication, NOT Supabase Auth. The app verifies
-- the Privy token server-side and then reads/writes these tables using the
-- Supabase SERVICE ROLE key. Therefore Row Level Security is ENABLED on every
-- table with NO public policies — the anon/public key can read nothing. All
-- access flows through the server after a verified Privy login.

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at helper: keeps updated_at fresh on every UPDATE
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- users — core identity. "Who is this", nothing more.
-- ---------------------------------------------------------------------------
create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  privy_user_id   text unique not null,   -- links to the Privy auth identity
  email           text unique not null,   -- required for signups + notifications
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz             -- soft-delete without breaking FKs
);

create index if not exists users_privy_user_id_idx on users (privy_user_id);

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles — everything ABOUT a user. One row per user.
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  full_name         text,
  date_of_birth     date,
  biological_sex    text, -- 'male' | 'female' | 'prefer_not_to_say'
  timezone          text,
  primary_goal      text, -- 'fat_loss' | 'muscle_gain' | 'hrv' | 'longevity' | 'metabolic_health'
  activity_level    text, -- 'sedentary' | 'light' | 'moderate' | 'high'
  known_conditions  text, -- free-text or JSON summary for v1
  country           text,
  city              text,
  marketing_consent boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id)  -- one profile per user
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- connections — external device / lab integrations (Oura, Apple Health, labs).
-- Keeps provider tokens + external IDs OUT of the core user row.
--
-- SECURITY: access_token / refresh_token are placeholders for later phases.
-- These MUST be encrypted (Supabase Vault / pgsodium or app-level encryption)
-- BEFORE any real token is written here. Do not store plaintext tokens in prod.
-- ---------------------------------------------------------------------------
create table if not exists connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  provider          text not null,        -- 'oura' | 'apple_health' | 'labcorp' | ...
  external_user_id  text,                 -- the user's id at the provider
  access_token      text,                 -- ENCRYPT before real use (see note above)
  refresh_token     text,                 -- ENCRYPT before real use (see note above)
  token_expires_at  timestamptz,
  scopes            text,
  status            text not null default 'active', -- 'active' | 'revoked' | 'error'
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, provider)  -- one connection per provider per user (v1)
);

create index if not exists connections_user_id_idx on connections (user_id);

create trigger connections_set_updated_at
  before update on connections
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- events — append-only timeline for the agentic layer.
-- e.g. blood_test_uploaded -> recommendation_accepted -> protocol_suggested
-- ---------------------------------------------------------------------------
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  type        text not null,                       -- event name / kind
  metadata    jsonb not null default '{}'::jsonb,  -- arbitrary structured payload
  created_at  timestamptz not null default now()
);

create index if not exists events_user_id_created_at_idx on events (user_id, created_at desc);
create index if not exists events_type_idx on events (type);

-- ---------------------------------------------------------------------------
-- Row Level Security: enable everywhere, add NO policies.
-- With RLS on and no policies, the anon/public key is denied all access.
-- The service-role key bypasses RLS, so the server retains full access.
-- ---------------------------------------------------------------------------
alter table users       enable row level security;
alter table profiles    enable row level security;
alter table connections enable row level security;
alter table events      enable row level security;
