-- ---------------------------------------------------------------------------
-- 0023: let a COROS connection exist.
--
-- WHAT THIS IS. One line: `wearable_connections.provider` is constrained to a
-- list of vendor ids, that list was written when there were six, and COROS is
-- the seventh. Without this the very first successful COROS OAuth callback
-- fails on the insert, AFTER the member has read a consent screen and tapped
-- Approve, with a constraint violation that says nothing about watches.
--
-- WHY IT LANDS BEFORE THE VENDOR ANSWERS. COROS access was applied for on
-- 2026-08-18 and no credentials have been issued, so nothing can write a
-- 'coros' row today: the provider is hidden by its `unavailable` reason and the
-- connect route refuses a vendor with no client id. That makes this migration
-- entirely inert on production right now, which is exactly when a schema change
-- is cheapest to make. The alternative is remembering it on the day the
-- credentials land, which is the day nobody is thinking about constraints.
--
-- THE LIST IS THE ONLY THING THAT CHANGES. Same columns, same semantics, same
-- table. `wearable_workouts` and `wearable_source_preferences` deliberately do
-- not constrain their provider column at all (see 0020 and 0022), so there is
-- nothing to change there.
--
-- Idempotent: the constraint is dropped by name and recreated, so running this
-- twice is the same as running it once.
-- ---------------------------------------------------------------------------

alter table wearable_connections
  drop constraint if exists wearable_connections_provider_check;

alter table wearable_connections
  add constraint wearable_connections_provider_check
  check (provider in ('oura', 'fitbit', 'whoop', 'withings', 'garmin', 'ultrahuman', 'coros'));
