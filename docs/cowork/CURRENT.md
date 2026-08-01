# Cowork — what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below — one line each,
no instructions.

Last updated: 2026-07-30. **One task pending: migration 0018.**

---

## Already applied — do NOT re-run

| Migration | Status |
|---|---|
| `0013_points_rank_split` | Applied to production 2026-07-28, verified. Backfills matched per user (`iki_score` == ledger earned, `best_streak` == check-in peak), triggers live, all user codes adopted into `invite_codes`. |
| `0014_rls_on_partners_and_invite_codes` | Applied 2026-07-28, verified. RLS on both tables, no policies, schema-wide sweep clean. |
| `0015_wearable_connections` | Applied 2026-07-30, verified. Both tables live, RLS on with no policies, idempotency index present, no rows touched. |
| `0016_device_requests` | Applied 2026-07-30, verified. 8 columns, RLS on with 0 policies, unique `(user_id, device_key)` index present, table empty, `users`/`wearable_connections` counts unchanged. |
| `0017_access_granted_email` | Applied 2026-07-30, verified. `users.access_granted_email_at` present and nullable, 0 of 4 users stamped, access breakdown unchanged. |

| Configuration | Status |
|---|---|
| `WEARABLE_TOKEN_KEY` | Set on prod Worker `ai-tools` 2026-07-30 via the Cloudflare dashboard, verified present as a Secret. Not set on `ikigaro-reminders` or staging — correct. |
| `GARMIN_PUSH_SECRET` | Set on prod `ai-tools` 2026-07-30, URL-safe alphanumeric, saved to the founder's password manager. Needed again on Garmin's application form. |
| `RESEND_API_KEY` | Set on prod `ai-tools` 2026-07-30 as a **Secret** (survives deploys — plaintext vars are replaced by `wrangler.jsonc` on every deploy). Sending-access-only key, scoped to `ikigaro.com`. |
| Resend domain | `ikigaro.com` verified 2026-07-30 as the **root** domain (not `send.ikigaro.com`), so `From: team@ikigaro.com` is valid. Records are subdomain-scoped in Cloudflare; the existing Hostinger SPF/MX/DKIM/DMARC were left untouched and no second SPF was added. |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | **Deliberately unset — do not add them.** The code defaults to `Ajinkya from Ikigaro <team@ikigaro.com>`, a real Hostinger mailbox that receives, so replies go to `From` by default. Setting these as dashboard plaintext vars would be wiped on the next deploy anyway. |

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

**Must run BEFORE the broadcasts PR is merged.** The code reads two tables and
two columns that do not exist yet.

---

Apply migration `0018_broadcasts` to the production Supabase database, then
verify it.

The file is `supabase/migrations/0018_broadcasts.sql`. It adds the ability to
send announcements to users from the admin console. It creates:

- two new tables — `broadcasts` and `broadcast_recipients`
- two new columns on `users` — `email_opt_out` (boolean, default false) and
  `unsubscribe_token` (uuid, auto-generated per user)

It does **not** modify or delete any existing data. The two new columns get
defaults, so every existing user is opted IN to announcements and gets a
random unsubscribe token — which is what we want.

## Apply

Supabase dashboard → SQL Editor → paste the file → Run.

## Verify — please run these and paste the output

**1. Both tables exist**

```sql
select table_name from information_schema.tables
where table_name in ('broadcasts', 'broadcast_recipients');
```

Expect both.

**2. RLS on, no policies, on both**

```sql
select relname, relrowsecurity from pg_class
where relname in ('broadcasts', 'broadcast_recipients');
select tablename, count(*) from pg_policies
where tablename in ('broadcasts', 'broadcast_recipients') group by tablename;
```

Expect `relrowsecurity = true` for both and **zero** policies. Same house rule
as every other table.

**3. Every user got a unique unsubscribe token**

```sql
select count(*) as users,
       count(unsubscribe_token) as with_token,
       count(distinct unsubscribe_token) as distinct_tokens,
       count(*) filter (where email_opt_out) as opted_out
from users;
```

All four numbers matter. `users`, `with_token` and `distinct_tokens` must be
**identical** — a duplicate or missing token means someone either cannot
unsubscribe or would unsubscribe the wrong person. `opted_out` must be **0**.

**4. The no-double-send guard exists**

```sql
select indexname from pg_indexes where tablename = 'broadcast_recipients';
```

Expect `broadcast_recipients_unique` among them. Without it, resuming a
partially-sent announcement could email the same person twice.

**5. Nothing else moved**

```sql
select access_status, count(*) from users group by access_status;
```

Should be unchanged.

## Do not

- Do not insert any test rows into `broadcasts` or `broadcast_recipients`.
- Do not send any announcement. I will test with the "Send test to me" button.
- Do not set `email_opt_out` on anyone.
- Do not paste keys, tokens or connection strings into chat. The unsubscribe
  tokens are per-user secrets — send me counts, never values.

## Report back

The output of all five checks. Once confirmed I will merge the code.

---

## After that, nothing is pending

Two things are waiting on the founder rather than on Cowork:

- **Wearable vendor applications** — see
  [`../WEARABLES_APPLICATIONS.md`](../WEARABLES_APPLICATIONS.md). Nothing can
  be configured until credentials arrive.
- **Supabase backups.** The production database is on the Free plan: no
  backups, no point-in-time recovery. Worst case is total loss. This is a
  spend decision (Pro, $25/mo), deliberately deferred until ~20 testers — not
  an oversight. It is the largest standing risk in the stack.


## Later, as each provider's credentials arrive

When a vendor comes through, it is two commands and a deploy:

```bash
wrangler secret put OURA_CLIENT_ID
wrangler secret put OURA_CLIENT_SECRET
```

…and the same pair for `FITBIT_`, `WHOOP_`, `WITHINGS_`, `GARMIN_`,
`ULTRAHUMAN_`. Each provider appears in Settings on its own once both halves are
set. Nothing else to switch on.
