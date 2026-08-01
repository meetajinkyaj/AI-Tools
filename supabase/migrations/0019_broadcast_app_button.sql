-- 0019: make the "Open Ikigaro" button opt-in per announcement.
--
-- THE POINT. Every announcement carried the button whether or not it was
-- relevant. A generic call to action on a message that is not asking anyone to
-- open the app is noise, and worse, it competes with whatever the message is
-- actually asking for. "Reply and tell us which device you use" reads weaker
-- with a large black button underneath pointing somewhere else.
--
-- WHY IT IS STORED PER BROADCAST RATHER THAN BEING A GLOBAL SETTING. Sending is
-- resumable: a run that stops at the 50-message cap finishes later from the
-- stored row. If this lived in a config value or in the composer's memory, the
-- second half of a send could render differently from the first, and the same
-- announcement would reach two groups of people looking like two different
-- emails. The broadcast row is the only place that survives between runs.
--
-- DEFAULT FALSE, deliberately. Existing rows keep the button off, which is the
-- new intent rather than the old behaviour. That is safe here because the only
-- rows this could alter are ones already fully sent, and re-rendering a sent
-- broadcast is not something the code ever does.

alter table broadcasts
  add column if not exists include_app_button boolean not null default false;

comment on column broadcasts.include_app_button is
  'Whether this announcement renders the "Open Ikigaro" button. Off unless the admin ticked it, so the button only appears when the message is genuinely asking someone to open the app.';
