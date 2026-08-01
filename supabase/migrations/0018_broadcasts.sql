-- 0018: send an announcement to users from the admin console.
--
-- THE POINT. There is currently no way to tell users anything. The only email
-- that exists fires on approval. When a feature ships, or a beta ends, or
-- something breaks, the only options are messaging people individually or
-- saying nothing.
--
-- WHY THIS SCHEMA IS BIGGER THAN "A SUBJECT AND A BODY".
--
-- An announcement is not transactional mail. The "you're in" email is a direct
-- response to an action the user took; a broadcast is us deciding to contact
-- people. That difference is the whole reason for the extra tables and columns
-- here:
--
--   1. OPT-OUT IS MANDATORY. Without an unsubscribe path, recipients who do not
--      want the mail have exactly one tool: the spam button. Enough of those
--      and the DOMAIN's reputation is damaged — which would take down the
--      approval email too, silently, and long after the broadcast that caused
--      it. Protecting the transactional channel is the real reason this
--      column exists, not compliance theatre.
--
--   2. ONE ROW PER RECIPIENT. Sending is a loop over an external API that can
--      fail halfway. Without per-recipient state, a retry re-mails everyone
--      who already received it, and the only thing worse than an announcement
--      nobody reads is the same one arriving three times.

-- ---------------------------------------------------------------------------
-- Opting out, and the link that does it
-- ---------------------------------------------------------------------------

alter table users
  add column if not exists email_opt_out boolean not null default false;

-- A per-user unguessable token, rather than an HMAC over the id.
--
-- A random token needs no signing secret to exist, rotate or leak, and it can
-- be revoked for one user by updating one row. 122 bits of randomness is not
-- brute-forceable, and the worst case if one leaks is that a stranger can
-- unsubscribe one person from announcements.
alter table users
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists users_unsubscribe_token
  on users (unsubscribe_token);

comment on column users.email_opt_out is
  'True when the user has unsubscribed from ANNOUNCEMENTS. Never suppresses transactional mail such as the access-granted email, which answers an action they took.';

-- ---------------------------------------------------------------------------
-- broadcasts — one row per announcement written
-- ---------------------------------------------------------------------------

create table if not exists broadcasts (
  id             uuid primary key default gen_random_uuid(),

  subject        text not null,
  -- Stored as the plain text the admin typed. Rendering to HTML happens at
  -- send time from this source, so what is stored is what was written and
  -- there is no half-escaped markup to re-interpret later.
  body           text not null,

  -- Which group was chosen. Kept as the label, not a resolved id list: the
  -- membership at send time is recorded in broadcast_recipients, so this only
  -- has to explain the intent afterwards.
  audience       text not null,

  created_by     text not null,
  created_at     timestamptz not null default now(),

  -- 'draft' until the first recipient is attempted, then 'sending', then
  -- 'sent'. A broadcast that ran out of daily quota stays 'sending' and can be
  -- resumed — which is the difference between a stuck job and a lost one.
  status         text not null default 'draft',
  started_at     timestamptz,
  completed_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- broadcast_recipients — one row per person per broadcast
-- ---------------------------------------------------------------------------

create table if not exists broadcast_recipients (
  id            uuid primary key default gen_random_uuid(),
  broadcast_id  uuid not null references broadcasts(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,

  -- Snapshotted, not joined. If the user later changes their address, the
  -- record of where this message actually went must not change with it.
  email         text not null,

  -- 'pending' | 'sent' | 'failed'
  status        text not null default 'pending',
  error         text,
  sent_at       timestamptz,

  created_at    timestamptz not null default now()
);

-- THE GUARD THAT MAKES RESUMING SAFE. One row per person per broadcast means a
-- resume can select only the pending rows and cannot possibly re-send to
-- someone already marked sent.
create unique index if not exists broadcast_recipients_unique
  on broadcast_recipients (broadcast_id, user_id);

create index if not exists broadcast_recipients_pending
  on broadcast_recipients (broadcast_id, status);

-- RLS on, no policies: deny-all for anon and authenticated, service role
-- bypasses. Both tables are admin-only and reached exclusively through server
-- routes that have already checked the caller against ADMIN_EMAILS.
alter table broadcasts           enable row level security;
alter table broadcast_recipients enable row level security;
