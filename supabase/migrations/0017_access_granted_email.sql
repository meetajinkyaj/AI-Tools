-- 0017: remember that we told someone they were let in.
--
-- THE POINT. Approving a user off the waitlist currently changes a column and
-- nothing else. The person finds out by opening the app and noticing it works,
-- which means the gap between "approved" and "actually using it" is however
-- long it takes them to wander back. The waitlist screen even promises "when
-- your access opens, this screen becomes the app", true only if they happen to
-- be looking at it.
--
-- WHY A COLUMN AND NOT JUST SENDING. Sending is easy; sending exactly once is
-- the hard part. Without a record, any retry, double-click on Approve, or
-- re-run of an admin action mails the same person again, and the one email we
-- send in this product's entire life should not arrive twice.
--
-- WHY IT IS NULLABLE AND CLEARED ON RE-WAITLIST. A user who is put back on the
-- waitlist and later approved again is genuinely being let in again, and should
-- be told again. Clearing the stamp at the moment access is revoked is what
-- makes the second approval able to notify, without ever allowing a second
-- email for the same grant.
--
-- Existing approved users are unaffected: they keep a null stamp, and nothing
-- sweeps this table looking for nulls to mail. The email is sent only on the
-- waitlisted -> approved transition itself.

alter table users
  add column if not exists access_granted_email_at timestamptz;

comment on column users.access_granted_email_at is
  'When the "you''re in" email was sent for the CURRENT access grant. Null means not sent. Cleared when a user is re-waitlisted so a later re-approval can notify again.';
