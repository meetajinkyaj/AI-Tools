# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-07-30. **One task pending: migration 0019.**

---

## Already applied, do NOT re-run

| Migration | Status |
|---|---|
| `0013_points_rank_split` | Applied to production 2026-07-28, verified. Backfills matched per user (`iki_score` == ledger earned, `best_streak` == check-in peak), triggers live, all user codes adopted into `invite_codes`. |
| `0014_rls_on_partners_and_invite_codes` | Applied 2026-07-28, verified. RLS on both tables, no policies, schema-wide sweep clean. |
| `0015_wearable_connections` | Applied 2026-07-30, verified. Both tables live, RLS on with no policies, idempotency index present, no rows touched. |
| `0016_device_requests` | Applied 2026-07-30, verified. 8 columns, RLS on with 0 policies, unique `(user_id, device_key)` index present, table empty, `users`/`wearable_connections` counts unchanged. |
| `0017_access_granted_email` | Applied 2026-07-30, verified. `users.access_granted_email_at` present and nullable, 0 of 4 users stamped, access breakdown unchanged. |
| `0018_broadcasts` | Applied 2026-07-30, verified. Both tables live, RLS on with 0 policies, `broadcast_recipients_unique` present, 4/4/4 unique unsubscribe tokens, 0 opted out, access breakdown unchanged. |

| Configuration | Status |
|---|---|
| `WEARABLE_TOKEN_KEY` | Set on prod Worker `ai-tools` 2026-07-30 via the Cloudflare dashboard, verified present as a Secret. Not set on `ikigaro-reminders` or staging, correct. |
| `GARMIN_PUSH_SECRET` | Set on prod `ai-tools` 2026-07-30, URL-safe alphanumeric, saved to the founder's password manager. Needed again on Garmin's application form. |
| `RESEND_API_KEY` | Set on prod `ai-tools` 2026-07-30 as a **Secret** (survives deploys, plaintext vars are replaced by `wrangler.jsonc` on every deploy). Sending-access-only key, scoped to `ikigaro.com`. |
| Resend domain | `ikigaro.com` verified 2026-07-30 as the **root** domain (not `send.ikigaro.com`), so `From: team@ikigaro.com` is valid. Records are subdomain-scoped in Cloudflare; the existing Hostinger SPF/MX/DKIM/DMARC were left untouched and no second SPF was added. |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | **Deliberately unset, do not add them.** The code defaults to `Ajinkya from Ikigaro <team@ikigaro.com>`, a real Hostinger mailbox that receives, so replies go to `From` by default. Setting these as dashboard plaintext vars would be wiped on the next deploy anyway. |

| Verification | Status |
|---|---|
| Wearables UI on production | Confirmed live 2026-07-30 on `app.ikigaro.com`. Settings shows **Connected devices** with the coming-soon copy and Apple Health / Google Health Connect listed; Home shows the **Your devices** card. No Connect buttons on either surface, correct, since no provider credentials exist yet. Dismiss ✕ persists across reload. No app console errors. |

| Repo hygiene | Status |
|---|---|
| Branch cleanup | 2026-07-30: all 30 stale branches deleted, leaving only `main`. **"Automatically delete head branches" is now enabled** in Settings → General, so merged PRs clean up after themselves, do not let this pile up again. |

**No database work is pending, both base secrets are set, and the UI is
verified live.**

---

# PENDING TASK, paste everything below the line into Cowork

**Must run BEFORE the app-button PR is merged.** The code writes a column that
does not exist yet.

---

Apply migration `0019_broadcast_app_button` to production, then verify.

The file is `supabase/migrations/0019_broadcast_app_button.sql`. It adds **one
column** to the existing `broadcasts` table:
`include_app_button boolean not null default false`.

That is the whole migration. No new table, no backfill, no change to any
existing value. It makes the "Open Ikigaro" button in announcements opt-in
instead of always-on.

## Apply

Supabase dashboard, SQL Editor, paste the file, Run.

## Verify, please paste the output

**1. The column exists with the right default**

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'broadcasts' and column_name = 'include_app_button';
```

Expect one row: `boolean`, `is_nullable = NO`, default `false`.

**2. No existing announcement was switched on**

```sql
select count(*) as broadcasts,
       count(*) filter (where include_app_button) as with_button
from broadcasts;
```

`with_button` must be **0**. Anything else would mean an already-sent
announcement now claims to have carried a button it did not.

**3. Nothing else moved**

```sql
select count(*) from users;
select count(*) from broadcast_recipients;
```

Tell me both numbers; they should be unchanged.

## Do not

- Do not send any announcement. I will test with "Send test to me".
- Do not insert or edit rows in `broadcasts` or `broadcast_recipients`.
- Do not paste keys, tokens or connection strings into chat.

## Report back

The output of all three checks. Once confirmed I will merge the code.

---

## After that, nothing is pending

Two things are waiting on the founder rather than on Cowork:

- **Wearable vendor applications**, see
  [`../WEARABLES_APPLICATIONS.md`](../WEARABLES_APPLICATIONS.md). Nothing can
  be configured until credentials arrive.
- **Supabase backups.** The production database is on the Free plan: no
  backups, no point-in-time recovery. Worst case is total loss. This is a
  spend decision (Pro, $25/mo), deliberately deferred until ~20 testers, not
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
