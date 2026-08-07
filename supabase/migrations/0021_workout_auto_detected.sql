-- ---------------------------------------------------------------------------
-- 0021: did the member start this session, or did their device notice it?
--
-- WHY THIS COLUMN EXISTS. Fitbit's SmartTrack logs a "Walk" after roughly
-- fifteen minutes of sustained movement, unasked. The first cut of the Fitbit
-- workout adapter simply threw those away, on the grounds that walking to the
-- station is not training and counting it would show a member seven training
-- days out of seven having trained on none.
--
-- That was half right and it discarded real data. A walk IS movement, and
-- movement is most of what this app is actually about: load-bearing and
-- everyday activity act on bone, muscle, gut and metabolic health whether or
-- not anybody would call it a workout. Deleting it at the adapter meant the
-- one signal we had for it never reached the database at all.
--
-- So the session is stored either way, and the DISTINCTION is stored with it.
-- What separates the two is INTENT: a session the member started is training,
-- because they meant it to be. A session their device noticed is movement.
-- That rule is one sentence to explain to a user, needs no per-sport
-- thresholds, and it leaves the judgment call where it belongs: somebody who
-- considers their auto-detected hour a real session can log it at check-in,
-- and the training view already reconciles the two sources per day.
--
-- FALSE IS THE RIGHT DEFAULT FOR EVERY EXISTING ROW, and for every provider
-- other than Fitbit. Oura, Whoop and Ultrahuman do not tell us how a session
-- came to exist, so we do not claim to know; treating theirs as member-started
-- preserves exactly the behaviour those rows already had.
--
-- Idempotent, like every migration here. Safe to re-run. Additive only: no
-- existing row changes meaning, and code that never reads the column behaves
-- as it did before.
-- ---------------------------------------------------------------------------

alter table wearable_workouts
  add column if not exists auto_detected boolean not null default false;

comment on column wearable_workouts.auto_detected is
  'True when the vendor detected the session rather than the member starting '
  'it (Fitbit logType = auto_detected). Movement rather than training. Only '
  'Fitbit reports this today; every other provider stays false because they '
  'do not say, not because we know.';
