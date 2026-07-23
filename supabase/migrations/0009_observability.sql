-- 0009: Observability — client-side error capture + RLS gap fix.
--
--   1. client_errors: browser errors reported by the app (window.onerror /
--      unhandledrejection). user_id is NULLABLE on purpose — the most damaging
--      crashes (white screens) happen BEFORE auth, and those reports matter
--      most. Payload sizes are capped by the API, not the schema.
--   2. RLS: push_subscriptions (0007) and voucher_codes (0008) missed the
--      "enable RLS everywhere, no policies" convention — closed here. All
--      access is service-role, which bypasses RLS, so this changes nothing for
--      the app and everything for defense in depth.
--
-- Idempotent.

create table if not exists client_errors (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete set null, -- null = pre-auth
  message     text not null,
  stack       text,
  url         text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists client_errors_created_idx
  on client_errors (created_at desc);

alter table client_errors     enable row level security;
alter table push_subscriptions enable row level security;
alter table voucher_codes      enable row level security;
