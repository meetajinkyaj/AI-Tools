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

**The zone as it actually stands, read 2026-08-19**, because the table above
describes the setup and not the result, and the two differ in a way that
matters when somebody is editing DNS in a hurry:

| Name | Type | Purpose |
|---|---|---|
| `ikigaro.com` | MX | `mx1`/`mx2.hostinger.com`. **Apex mail is Hostinger, not Resend** |
| `ikigaro.com` | TXT | SPF for **Hostinger**: `v=spf1 include:_spf.mail.hostinger.com ~all` |
| `send.ikigaro.com` | MX + TXT | Resend's own subdomain, with SPF `include:amazonses.com` |
| `resend._domainkey` | TXT | Resend's DKIM key |
| `hostingermail-{a,b,c}._domainkey` | CNAME | Hostinger's DKIM keys |
| `_dmarc` | TXT | `v=DMARC1; p=none` |

**Resend lives on the `send.` subdomain**, which is Resend's own recommendation
and is worth knowing before touching the apex. An earlier note in this repo
assumed Resend's records sat at the apex; they do not, and somebody acting on
that assumption would be editing Hostinger's mail records believing they were
editing ours.

### DKIM does not pass, and the Cloudflare fix was not the reason why

**Two days, two findings, and the first one was not the cause.** Written out in
order because the sequence is the lesson.

**2026-08-19, the proxy problem, real but beside the point.**
`hostingermail-a/b/c._domainkey` were CNAMEs marked **Proxied**. A proxied
Cloudflare record answers A and AAAA with Cloudflare's own anycast addresses and
does not expose its CNAME target, while DKIM verification is a **TXT** lookup
that has to follow that CNAME to Hostinger. Measured before the fix:

```
TXT hostingermail-a._domainkey.ikigaro.com  ->  (empty)
A   hostingermail-a._domainkey.ikigaro.com  ->  104.21.74.251, 172.67.209.16
```

The proxy was turned off on those three plus `autoconfig` and `autodiscover`,
the zone stayed at 17 records, and the keys began resolving. **This was reported
as "DKIM fixed". It was not.**

**2026-08-20, the actual cause, found by sending a real message.** Gmail's
verdict on mail from `team@ikigaro.com`:

```
dkim=permerror (no key for signature) header.i=@ikigaro.com header.s=hostingermail1
spf=pass   (designates 23.83.217.12 as permitted sender)
dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=ikigaro.com
```

**Hostinger signs with `s=hostingermail1`.** The records in DNS are
`hostingermail-a`, `-b` and `-c`. Different names.
`hostingermail1._domainkey.ikigaro.com` is **NXDOMAIN**, so a receiver looks up
the key named in the signature, finds nothing, and returns `permerror`. Gmail
displays that as DKIM FAIL.

So the records that were un-proxied are **not the selector Hostinger actually
uses**. Fixing their proxy status was correct housekeeping (mail records should
never be proxied, and `autoconfig` / `autodiscover` genuinely needed it) and it
changed the DKIM outcome not at all.

**WHY THE FIRST ANSWER LOOKED SO CONVINCING.** A broken thing was found, it was
genuinely broken, fixing it made the symptom under observation go away, and the
symptom under observation was the wrong one. "The key now resolves" is not "the
message now verifies", and only a real message tells you which you have. That
gap is the whole reason the end-to-end test exists, and it is worth remembering
the next time a DNS fix looks self-evidently complete.

### What this costs today, and what it risks

**Mail is being delivered.** SPF passes and DMARC passes through SPF alignment,
so the Hostinger mailbox reaches inboxes now: the test landed in Inbox, not
Spam or Promotions.

**It is riding on SPF alone.** DKIM contributes nothing, so there is no fallback
in the one case SPF cannot survive: **forwarding**. A forwarded message keeps
its DKIM signature and loses its SPF, so a member who forwards our mail, or
whose address auto-forwards, hands the receiver a message that fails both. That
is invisible until it happens and unattributable when it does.

### Resolved 2026-08-20: the missing selector was published, and DKIM passes

Hostinger's documented scheme uses three selectors published as CNAMEs,
`hostingermail-{a,b,c}._domainkey`, all of which were already correct here. The
selector their server actually signs with, `hostingermail1`, was in neither our
zone nor Hostinger's own DNS, so there was nothing to point a CNAME at and no
key to copy. **The record came from hPanel**, where Hostinger publish it even
though their support docs do not mention it.

Published as an additive record, DNS-only. The zone went 17 to 18 and nothing
else moved. It resolves from Google, Cloudflare, Quad9 and OpenDNS.

**Proven with a real message, which is the only proof that counts:**

```
dkim=pass  header.i=@ikigaro.com header.s=hostingermail1 header.b=TNJ6reyy
spf=pass   (designates 23.83.217.22 as permitted sender)
dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=ikigaro.com
```

All three green in Gmail. DKIM signs at the domain level, so this holds for
every mailbox on `ikigaro.com`, not only the one that sent the test.

**`hostingermail-a/b/c` were left in place.** They are harmless, they resolve
correctly, and if Hostinger rotate selectors they may become live.

#### Two things this cost, worth not repeating

**The end-to-end test should have run first.** One sent message showed
`s=hostingermail1` immediately. Instead the investigation started from the zone,
found a real but unrelated problem (the proxied CNAMEs), fixed it, and reported
DKIM as fixed on the strength of the symptom under observation going away. It
had not been fixed. **"The key resolves" is not "the message verifies"**, and
only a real message distinguishes them.

**Vendor docs are not the vendor's system.** Hostinger's support article lists
three selectors and their server uses a fourth. The reconciliation that
mattered came from hPanel and from a header, not from documentation.

### The Resend path, still only half checked

`resend._domainkey.ikigaro.com` publishes a valid key and did so throughout,
from all four public resolvers, so the members' path was never affected by any
of this. **It has still not been proven with a real message**, because no app
mail exists in the test inbox yet (pre-launch) and the admin console sits behind
Cloudflare Access.

Closing it takes seconds when somebody is in the admin console: **Email, compose
anything, "Send test to me"**, then Show original on the result. Expect
`dkim=pass d=ikigaro.com` via the Resend selector, SPF evaluated against
`send.ikigaro.com`, both aligning to `ikigaro.com` under relaxed mode.

Note that `team@ikigaro.com` is deliberately both the app's `From` (through
Resend) and a real Hostinger mailbox that receives replies, so **the same
address sends down both paths** and needs DKIM working on each.

### DMARC is `p=none`, and the order of operations matters

`_dmarc.ikigaro.com` reads `v=DMARC1; p=none`, with no `rua=`. So it is neither
enforcing nor collecting the reports that would justify enforcing, and nothing
is driving it forward.

**The right order, and it is not the obvious one:**

1. ~~Get the Hostinger path signing verifiably.~~ **Done 2026-08-20**,
   `dkim=pass` confirmed on a real message.
2. Confirm the Resend path the same way.
3. Add `rua=` so aggregate reports start arriving, and read them for a few
   weeks. Free, and changes nothing about delivery.
4. Only then consider `p=quarantine`.

**Do not skip to step 4.** The Hostinger path currently survives on SPF
alignment alone, so tightening the policy while DKIM fails is how a domain
sends its own mail to spam.

### One thing the apex SPF does not cover

`ikigaro.com`'s SPF is `v=spf1 include:_spf.mail.hostinger.com ~all`: Hostinger
only, no Resend. The app sends **From: `team@ikigaro.com`** (see
`DEFAULT_FROM` in `src/lib/email.ts`), which is the apex, while the envelope is
`send.ikigaro.com`.

Under DMARC's default **relaxed** alignment this is fine, because
`send.ikigaro.com` and `ikigaro.com` share an organizational domain and the
Resend DKIM signs as `ikigaro.com` anyway. It would stop being fine under
**strict** alignment. Worth remembering at step 3 above, rather than
discovering it when member email starts bouncing.

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
