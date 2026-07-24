-- 0010: Beta waitlist — gate app access behind an approval.
--
-- New signups land as 'waitlisted' (they can log in via Privy — which verifies
-- their email — but see only the waitlist screen and can't touch health-data
-- APIs). An admin flips them to 'approved' in the console's Users tab.
--
-- The backfill (everyone who signed up BEFORE the gate keeps access) runs
-- inside the column-creation guard, so re-running this migration later can
-- never accidentally approve users who are genuinely waitlisted. Idempotent.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'users' and column_name = 'access_status'
  ) then
    alter table users
      add column access_status text not null default 'waitlisted';
    -- Pre-gate users keep their access.
    update users set access_status = 'approved';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_access_status_check'
  ) then
    alter table users
      add constraint users_access_status_check
      check (access_status in ('waitlisted', 'approved'));
  end if;
end $$;
