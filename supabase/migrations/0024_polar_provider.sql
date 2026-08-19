-- ---------------------------------------------------------------------------
-- 0024: let a Polar connection exist.
--
-- Same one-line change as 0023 and for the same reason: the provider list on
-- `wearable_connections` is an explicit CHECK, and an id missing from it fails
-- the INSERT in the OAuth callback, AFTER the member has read a consent screen
-- and tapped Approve, with a constraint violation that says nothing about
-- watches.
--
-- THIS ONE IS NOT INERT, UNLIKE 0023. Polar credentials are live in the Worker,
-- so the moment the adapter merges a member can press Connect and this row will
-- be written for real. RUN THIS BEFORE THE ADAPTER MERGES, not after.
--
-- Idempotent: the constraint is dropped by name and recreated.
-- ---------------------------------------------------------------------------

alter table wearable_connections
  drop constraint if exists wearable_connections_provider_check;

alter table wearable_connections
  add constraint wearable_connections_provider_check
  check (provider in ('oura', 'fitbit', 'whoop', 'withings', 'garmin', 'ultrahuman', 'coros', 'polar'));
