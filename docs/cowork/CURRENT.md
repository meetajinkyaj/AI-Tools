# Cowork — what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below — one line each,
no instructions.

Last updated: 2026-07-30. **One task pending: migration 0016.**

---

## Already applied — do NOT re-run

| Migration | Status |
|---|---|
| `0013_points_rank_split` | Applied to production 2026-07-28, verified. Backfills matched per user (`iki_score` == ledger earned, `best_streak` == check-in peak), triggers live, all user codes adopted into `invite_codes`. |
| `0014_rls_on_partners_and_invite_codes` | Applied 2026-07-28, verified. RLS on both tables, no policies, schema-wide sweep clean. |
| `0015_wearable_connections` | Applied 2026-07-30, verified. Both tables live, RLS on with no policies, idempotency index present, no rows touched. |

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

**This must run BEFORE the device-requests PR is merged.** The code reads a
table that does not exist yet; merging first gives every user a broken
Settings page until the migration lands.

---

Apply migration `0016_device_requests` to the production Supabase database,
then verify it.

The file is `supabase/migrations/0016_device_requests.sql` in the repo. It
creates one new table for user-submitted device suggestions ("which wearable
should we add next"). It creates nothing else and **touches no existing table**
— no ALTER, no UPDATE, no backfill. If you see it proposing to modify an
existing table, stop and tell me.

## Apply

Supabase dashboard → SQL Editor → paste the file's contents → Run.

## Verify — please actually run these and paste the output

**1. The table exists with the right shape**

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'device_requests'
order by ordinal_position;
```

Expect 8 columns: `id`, `user_id`, `raw_text`, `device_key`, `notify`,
`notified_at`, `created_at`, `updated_at`.

**2. RLS is on with NO policies** — the house rule for every table

```sql
select relname, relrowsecurity from pg_class where relname = 'device_requests';
select count(*) from pg_policies where tablename = 'device_requests';
```

Expect `relrowsecurity = true` and a policy count of **0**. Both matter: RLS on
with zero policies means anon and authenticated can read nothing, and the
service role — which is what our server routes use — bypasses it. This is the
exact gap migration 0014 had to go back and close, so please confirm it rather
than assuming.

**3. The one-vote-per-person index exists**

```sql
select indexname from pg_indexes where tablename = 'device_requests';
```

Expect `device_requests_user_device` among them. Without it one person can
submit "Oura" five times and the admin tally will report five people.

**4. Nothing else changed**

```sql
select count(*) from users;
select count(*) from wearable_connections;
```

Tell me both numbers. They should match whatever they were before — this
migration has no reason to alter either.

## Do not

- Do not insert any test rows into `device_requests` on production. I want the
  first real row to be a real user.
- Do not paste keys, tokens or connection strings into chat.

## Report back

The output of all four checks, and confirmation that the table is empty. Once
you confirm, I will merge the code.

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
