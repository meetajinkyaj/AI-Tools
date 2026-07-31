# Cowork — what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below — one line each,
no instructions.

Last updated: 2026-07-30. **One task pending: migration 0017 + Resend setup.**

---

## Already applied — do NOT re-run

| Migration | Status |
|---|---|
| `0013_points_rank_split` | Applied to production 2026-07-28, verified. Backfills matched per user (`iki_score` == ledger earned, `best_streak` == check-in peak), triggers live, all user codes adopted into `invite_codes`. |
| `0014_rls_on_partners_and_invite_codes` | Applied 2026-07-28, verified. RLS on both tables, no policies, schema-wide sweep clean. |
| `0015_wearable_connections` | Applied 2026-07-30, verified. Both tables live, RLS on with no policies, idempotency index present, no rows touched. |
| `0016_device_requests` | Applied 2026-07-30, verified. 8 columns, RLS on with 0 policies, unique `(user_id, device_key)` index present, table empty, `users`/`wearable_connections` counts unchanged. |

| Configuration | Status |
|---|---|
| `WEARABLE_TOKEN_KEY` | Set on prod Worker `ai-tools` 2026-07-30 via the Cloudflare dashboard, verified present as a Secret. Not set on `ikigaro-reminders` or staging — correct. |
| `GARMIN_PUSH_SECRET` | Set on prod `ai-tools` 2026-07-30, URL-safe alphanumeric, saved to the founder's password manager. Needed again on Garmin's application form. |

| Verification | Status |
|---|---|
| Wearables UI on production | Confirmed live 2026-07-30 on `app.ikigaro.com`. Settings shows **Connected devices** with the coming-soon copy and Apple Health / Google Health Connect listed; Home shows the **Your devices** card. No Connect buttons on either surface — correct, since no provider credentials exist yet. Dismiss ✕ persists across reload. No app console errors. |

| Repo hygiene | Status |
|---|---|
| Branch cleanup | 2026-07-30: all 30 stale branches deleted, leaving only `main`. **"Automatically delete head branches" is now enabled** in Settings → General, so merged PRs clean up after themselves — do not let this pile up again. |

**No database work is pending, both base secrets are set, and the UI is
verified live.**

---

# PENDING TASK — paste everything below the line into Cowork

**Steps 1 and 2 must both be done BEFORE the email PR is merged.** The code
writes a column that does not exist yet.

Step 3 (Resend) can be done before or after the merge — until it is done,
approvals work exactly as they do now and simply send nothing.

---

Three things: a one-column migration, its verification, and setting up Resend
so the app can send its first email.

## STEP 1 — apply migration 0017

The file is `supabase/migrations/0017_access_granted_email.sql`.

It adds **one nullable column** to `users`:
`access_granted_email_at timestamptz`. That is the entire migration — no new
table, no backfill, no UPDATE, no change to any existing value. Adding a
nullable column takes no table lock worth worrying about at our size.

Supabase dashboard → SQL Editor → paste the file → Run.

## STEP 2 — verify, and paste the output

**1. The column exists and is nullable**

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'users' and column_name = 'access_granted_email_at';
```

Expect one row: `timestamp with time zone`, `is_nullable = YES`.

**2. Nobody was accidentally marked as already-emailed**

```sql
select count(*) as total,
       count(access_granted_email_at) as stamped
from users;
```

Expect `stamped = 0`. Every existing user must have a NULL stamp. A non-zero
number here would mean the column defaulted to a value, which would silently
suppress the email for those people forever.

**3. Existing access is untouched**

```sql
select access_status, count(*) from users group by access_status;
```

Tell me the breakdown. It should be identical to before — this migration has
no reason to change anyone's access.

## STEP 3 — set up Resend

We are adding transactional email. Today it sends exactly one message: "you're
in", when I approve someone off the waitlist. Right now approval is silent and
people only find out by opening the app, which most never do.

**a. Verify the domain**

1. Sign up / sign in at `resend.com` (free tier is fine — 3,000/month).
2. Domains → Add domain → `ikigaro.com`.
3. Resend shows three DNS records (an MX + SPF TXT, a DKIM TXT, and a DMARC
   TXT). Add all three wherever `ikigaro.com` DNS is managed — Cloudflare, if
   that is where the domain is.
4. Wait for Resend to show the domain as **Verified**. Usually minutes.

Tell me if any record conflicts with something already there — especially if
an SPF TXT record already exists. **Do not add a second SPF record**; a domain
with two is worse than one, and I would rather merge them by hand.

**b. Create the API key and set it on the Worker**

1. Resend → API Keys → Create, with **Sending access** only (not full access).
2. Set it as a secret on the production Worker `ai-tools`:

```bash
wrangler secret put RESEND_API_KEY
```

Or Cloudflare dashboard → Workers → `ai-tools` → Settings → Variables →
**Encrypt**. Paste the key into the secret field only.

**c. Set the reply-to address**

Add a plain (non-secret) environment variable on the same Worker:

`EMAIL_REPLY_TO` = an inbox that a human actually reads.

This matters: the email tells the user "just reply to this email". If replies
bounce, that sentence is a lie, and it is the one message where we most want a
reply.

## Do not

- Do not paste the Resend API key, any DNS record values, or any connection
  string into chat. The key goes into the secret field only.
- Do not send a test email to a real user. I will test it by approving my own
  account.
- Do not change any existing user's `access_status`.

## Report back

- The output of the three checks in step 2.
- Whether the Resend domain shows **Verified**, and whether any existing SPF
  record was already present.
- Confirmation that `RESEND_API_KEY` and `EMAIL_REPLY_TO` are both set on
  `ai-tools`.

Once steps 1 and 2 are confirmed I will merge the code.

---

## Later, as each provider's credentials arrive

When a vendor comes through, it is two commands and a deploy:

```bash
wrangler secret put OURA_CLIENT_ID
wrangler secret put OURA_CLIENT_SECRET
```

…and the same pair for `FITBIT_`, `WHOOP_`, `WITHINGS_`, `GARMIN_`,
`ULTRAHUMAN_`. Each provider appears in Settings on its own once both halves are
set. Nothing else to switch on.
