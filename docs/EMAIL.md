# Email

One provider (Resend), one message (`You're in.`), and a deliberate decision
about what we do *not* send.

---

## Why Resend, and why HTTP

The app runs on Cloudflare Workers, which have **no TCP sockets**. Every SMTP
library, `nodemailer` included, cannot run there at all. Resend's REST
endpoint is a plain `fetch`, so the integration is one function.

The free tier is 3,000 emails/month and 100/day. At beta scale, where a handful
of approvals a week is a busy week, that is not a constraint worth thinking
about.

## What we send

**Exactly one message today:** the access-granted email, sent when an admin
approves someone off the waitlist.

It exists because the waitlist screen makes a promise, *"when your access
opens, this screen becomes the app"*, that is only true for someone who
happens to be looking at it. Without the email, being approved is a silent
event that the person discovers whenever they next wander back, which for most
people is never.

### What it deliberately does not contain

| Not included | Why |
|---|---|
| Invite link / "bring your friends" | The beta is closed on purpose. The moment someone is let in is the worst possible moment to ask them to bring strangers to a waitlist. Mirrors `INVITE_LINK_ON_SHARED_CARDS`. |
| Medical disclaimer | The mail carries no health claim. Putting the disclaimer on messages that do not give health information is how it stops being read on the ones that do. |
| Tracking pixel / open tracking | Transactional mail. Nothing to load means nothing blocked. |
| Any health data | Never. No biomarker or check-in content leaves the app by email. |

### Sending exactly once

Sending is easy; sending *once* is the hard part. Three guards, all in code and
all unit-tested in `src/lib/emails/access-granted.test.ts`:

1. **The transition, not the state.** The route reads `access_status` *before*
   updating and only mails on `waitlisted → approved`. A double-clicked Approve
   on an already-approved user is not a new grant.
2. **A stamp.** `users.access_granted_email_at` records that this grant was
   announced. Set only *after* Resend accepts the message, stamping first
   would mean a failed send permanently marks the user as told.
3. **Cleared on revoke.** Re-waitlisting nulls the stamp, so someone let back
   in later is told again, while still never getting two emails for one grant.

### Failing soft

Approving a user must never depend on a third-party HTTP call. `sendEmail()`
returns a result rather than throwing, the approval is committed and audited
before the email is attempted, and a failure is logged to `events` as
`access_email_failed`. The admin UI reports which happened, *"Approved, and
emailed them"* versus *"Approved, but the email failed. Tell them yourself."*

**Not configured is not an error.** With no `RESEND_API_KEY`, approvals work
exactly as they do today and nothing is sent. That is the state until the
domain below is verified.

---

## Setup

### 1. Verify the domain in Resend

`resend.com` → Domains → Add `ikigaro.com`. Resend gives three DNS records:

| Type | Purpose |
|---|---|
| `MX` + `TXT` (SPF) | Authorises Resend to send as the domain |
| `TXT` (DKIM) | Signs outgoing mail |
| `TXT` (DMARC) | Tells receivers what to do with mail that fails the above |

Add them wherever `ikigaro.com` DNS lives (Cloudflare, if that is the
registrar). Propagation is usually minutes, occasionally a few hours.

**Start this early.** It is free, needs no code, and sending reputation warms
over days, the same reasoning as filing the Garmin application before it is
needed.

### 2. Set the secrets

```bash
wrangler secret put RESEND_API_KEY        # from resend.com -> API Keys
```

Two optional plain vars, settable in `wrangler.toml` or the dashboard:

| Variable | Default | Notes |
|---|---|---|
| `EMAIL_FROM` | `Ikigaro <team@ikigaro.com>` | Must be on the verified domain, **and must be an address that receives** |
| `EMAIL_REPLY_TO` | unset | Only needed if `From` is an address nobody reads. Leave unset while `From` is a real mailbox, replies go to `From` by default. |

`team@ikigaro.com` is a real Hostinger mailbox. That is load-bearing, not
incidental: the message tells the reader to reply to it. Receiving mail is
entirely separate from Resend. Resend only sends, and inbound mail is handled
by the domain's existing MX records. If `EMAIL_FROM` is ever pointed at an
address that does not receive, set `EMAIL_REPLY_TO` to one that does.

`APP_ORIGIN` already exists and is what the email's link uses, so staging mail
points at staging.

### 3. Send one to yourself first

Approve your own test account before approving a real user. Check it renders in
Gmail and does not land in spam. The plain-text part is what keeps it out of
spam, and it is easy to break invisibly.

---

---

## Announcements (Admin → Email)

Compose a subject and a plain-text body, pick an audience, send. History and
per-send counts are on the same screen.

### Transactional vs announcement, the distinction the whole design rests on

The access-granted email **answers something the user did**. An announcement is
**us deciding to contact them**. That difference drives everything below:

| | Access-granted | Announcement |
|---|---|---|
| Trigger | User was approved | Admin wrote it |
| Unsubscribe link | No | **Yes, always** |
| Suppressed by `email_opt_out` | No | Yes |
| Recorded per recipient | Via `access_granted_email_at` | `broadcast_recipients` row |

**Why the unsubscribe link is non-negotiable.** Without one, a recipient who
doesn't want the mail has exactly one tool: the spam button. Enough of those
and the *domain's* reputation degrades, which would silently take the
access-granted email down with it, long after the broadcast that caused it.
The opt-out exists to protect the transactional channel, not to satisfy a
lawyer.

Opting out never suppresses transactional mail. Someone who unsubscribes from
announcements and is later approved still hears that they're in.

### The composer takes plain text, not HTML

Blank lines become paragraphs. Everything typed is escaped before it reaches
the HTML, pasted content cannot introduce markup. If the box accepted HTML it
would be an injection path into every user's inbox, and mail clients render
only an inconsistent subset of HTML anyway.

The unsubscribe footer is added automatically.

### The "Open Ikigaro" button is opt-in, and off by default

A tick box in the composer. It exists because a generic call to action on a
message that is not asking anyone to open the app is noise, and it competes
with whatever the message actually wants: "reply and tell us which device you
use" reads weaker with a large button underneath pointing somewhere else.

The choice is stored on the broadcast row, not held in the composer or a
config value. Sending is resumable, so a run that stops at the 50-message cap
finishes later from that row; if the flag lived anywhere else the second half
of a send could render differently from the first, and one announcement would
reach two groups looking like two different emails.

**The access-granted email keeps its button unconditionally.** That message
exists to say "your access is open", so the button is the point rather than
decoration.

### Sending is resumable, and cannot double-send

1. The recipient list is resolved and frozen into `broadcast_recipients` as
   `pending` rows **before anything is sent**.
2. A run sends at most `MAX_PER_RUN` (50). Resend's free tier allows 100/day,
   and a Worker has a ceiling on outbound subrequests per invocation.
3. Anything left stays `pending`, the broadcast stays `sending`, and **Resume**
   picks up exactly the pending rows.

The unique index on `(broadcast_id, user_id)` is what makes a resume safe: it
is structurally impossible to send twice to the same person for one broadcast.

### Who is excluded automatically

Opted out, deleted accounts, and rows with no address. Recipients are also
deduplicated by address, so two accounts sharing an inbox get one copy.

The count shown next to the audience selector is the real post-exclusion
number, fetched live, not an estimate.

### Send a test first

The "Send test to me" button sits *before* the send button on purpose. There is
no way to inspect an email except by receiving one, and every mistake worth
catching, a collapsed paragraph, a subject that reads badly in a list, is
obvious in an inbox and invisible in a compose box.

### Unsubscribe is a two-step page, not a link that acts

`GET /api/email/unsubscribe?t=…` renders a confirmation page; only the `POST`
it submits changes anything. Mail providers and corporate gateways **prefetch
links to scan them**, a GET that performed the opt-out would unsubscribe
people who never clicked, and nobody would ever find out why the announcements
stopped.

The token is a random per-user UUID rather than a signed id: no signing secret
to manage or leak, revocable per user by updating one row, and 122 bits is not
guessable.

---

## Adding a third email later

The wearable launch announcement is the obvious next one: the `notify` opt-in
on `device_requests` already stores who asked, and `notified_at` already exists
so nobody can be mailed twice about the same device. Nothing sends yet, because
no vendor is live to announce.

Whatever it is, put the copy in `src/lib/emails/` as a pure function returning
an `EmailMessage`, and test the copy. The reason the message is a pure function
with no I/O is exactly so its content can be asserted without a network.
