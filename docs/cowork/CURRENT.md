# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-08-06. **Two tasks are pending, in order:** apply migration
`0020_wearable_workouts`, then set the two Oura secrets. See
[PENDING TASK](#pending-task).

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
| `0019_broadcast_app_button` | Applied 2026-07-30, verified. `broadcasts.include_app_button` boolean, not null, default false; 0 rows with it set; `users` and `broadcast_recipients` unchanged. The SQL Editor spinner hung during this run, so completion was confirmed from a second connection rather than from the UI. |

| Configuration | Status |
|---|---|
| `WEARABLE_TOKEN_KEY` | **Regenerated 2026-08-04** and verified working: tokens now encrypt and store. The original value set 2026-07-30 was not valid base64, so encryption had never once worked and nothing was ever stored under it, which is why rotating cost nothing. Not set on `ikigaro-reminders` or staging, correct. Note it is used two ways: base64-decoded as an AES key, and as a plain string to derive the OAuth state HMAC. Only the first was ever broken, which is why consent and callbacks worked throughout. |
| `GARMIN_PUSH_SECRET` | Set on prod `ai-tools` 2026-07-30, URL-safe alphanumeric, saved to the founder's password manager. Needed again on Garmin's application form. |
| `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` | Set on prod `ai-tools` 2026-08-04 as Secrets, and verified: Whoop renders a Connect button and reaches Whoop's real sign-in with no 503. The App is `Ikigaro` under team `Ikigaro` at developer-dashboard.whoop.com. Scopes ticked there include `read:workout`, which the code does not request, so it is granted-but-dormant and harmless. `offline` has no dashboard checkbox and is requested in the authorize URL, which is correct. |
| `RESEND_API_KEY` | Set on prod `ai-tools` 2026-07-30 as a **Secret** (survives deploys, plaintext vars are replaced by `wrangler.jsonc` on every deploy). Sending-access-only key, scoped to `ikigaro.com`. |
| Resend domain | `ikigaro.com` verified 2026-07-30 as the **root** domain (not `send.ikigaro.com`), so `From: team@ikigaro.com` is valid. Records are subdomain-scoped in Cloudflare; the existing Hostinger SPF/MX/DKIM/DMARC were left untouched and no second SPF was added. |
| `ULTRAHUMAN_CLIENT_ID` / `ULTRAHUMAN_CLIENT_SECRET` | Set on prod `ai-tools` 2026-08-03 as Secrets. Confirmed working: consent renders, returns a valid `code`, and the token exchange succeeds. The connect failure traced to `WEARABLE_TOKEN_KEY` being decoded with a strict `atob`, not to these credentials. Do not re-enter or rotate them. |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | **Deliberately unset, do not add them.** The code defaults to `Ajinkya from Ikigaro <team@ikigaro.com>`, a real Hostinger mailbox that receives, so replies go to `From` by default. Setting these as dashboard plaintext vars would be wiped on the next deploy anyway. |

| Verification | Status |
|---|---|
| Ultrahuman reconnected | 2026-08-04, after the row was lost to a Disconnect. Connect and Approve went straight through, and the card shows Disconnect with "synced just now". Healthy. |
| Whoop, connect blocked | 2026-08-04. Secrets are set and valid, and Connect reaches Whoop's real sign-in. Whoop then returns `request_unauthorized` with no code. **Confirmed not a credential, scope or config fault**, and not a whitelist: Whoop allow any WHOOP member to authorise a development-mode app up to a limit of ten, so there is nothing to add anybody to. It is blocked on the signing-in account having an active WHOOP membership, which the founder's band-less account does not. Needs a tester with a band. |
| First real wearable connection | **Achieved 2026-08-04**, after the key was regenerated. `?wearable=connected` for the first time; row has `status active`, `failure_count 0`, both tokens stored, `expires_at` 24h out, `last_error` null, and `last_sync_at` stamped by the app's own post-connect sync. This proves the token host, the metrics host, the `/authorise` spelling, the scope strings and the redirect URI. `external_user_id` is null and expected to be: `/user_info` is not called. Earlier note, kept because it explains the trail: **Not yet achieved.** The `atob` fix deployed clean, but the row on production turned out to be the pre-fix failed attempt: a shell with `status = 'active'` and no credentials, which the card rendered as Disconnect. Found by reading `connected_at`, which the upsert refreshes and which had not moved. The token host, `/authorise` spelling, scope strings and redirect URI are still proven by the successful code exchange that preceded the encryption failure. The metrics endpoint remains unproven. |
| Wearables UI on production | Confirmed live 2026-07-30 on `app.ikigaro.com`. Settings shows **Connected devices** with the coming-soon copy and Apple Health / Google Health Connect listed; Home shows the **Your devices** card. No Connect buttons on either surface, correct, since no provider credentials exist yet. Dismiss ✕ persists across reload. No app console errors. |

| Repo hygiene | Status |
|---|---|
| Branch cleanup | 2026-07-30: all 30 stale branches deleted, leaving only `main`. **"Automatically delete head branches" is now enabled** in Settings → General, so merged PRs clean up after themselves, do not let this pile up again. |

**No database work is pending, and the UI is verified live.** Ultrahuman's
OAuth app is registered and its consent screen works; only the token exchange
is outstanding.

---

# PENDING TASK

## 1. Apply migration `0020_wearable_workouts` to production

**Migration first, before the code that needs it merges.** Code reading a table
that does not exist takes the app down, which is why this ordering is a rule
here rather than a preference.

Supabase → SQL Editor → paste
[`supabase/migrations/0020_wearable_workouts.sql`](../../supabase/migrations/0020_wearable_workouts.sql)
and run it. Idempotent, safe to re-run.

### Then verify, and report each line

```sql
-- 1. The table exists with the columns we expect.
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'wearable_workouts'
order by ordinal_position;

-- 2. RLS is ON and there are NO policies. Both halves matter.
select relrowsecurity from pg_class where relname = 'wearable_workouts';
select count(*) from pg_policies where tablename = 'wearable_workouts';

-- 3. The idempotency index is present, which is what makes a re-sync
--    correct a session rather than duplicate it.
select indexname from pg_indexes where tablename = 'wearable_workouts';

-- 4. Nothing else was touched.
select count(*) from wearable_connections;
select count(*) from wearable_daily_metrics;
```

**Expected:** 17 columns, `relrowsecurity` **true**, **0** policies, indexes
including `wearable_workouts_key` and `wearable_workouts_read_idx`, and the two
existing tables unchanged.

**If `relrowsecurity` is false or the policy count is anything but 0, stop and
say so.** That combination is the only thing standing between the project's
anon key and the table, and migration 0013 shipped two tables without it once
already.

> If the SQL Editor's "Running..." spinner freezes, **do not re-click Run**.
> That happened on 0019. Check the real state from a second connection first: a
> frozen spinner says nothing about whether the statement committed.

## 2. Then set the two Oura secrets

Cloudflare → Workers & Pages → **`ai-tools`** → Settings → Variables and Secrets.

| Name | Type |
|---|---|
| `OURA_CLIENT_ID` | **Secret** |
| `OURA_CLIENT_SECRET` | **Secret** |

From `developer.ouraring.com`, application `Ikigaro`. **Type Secret, not
plaintext Variable**, and **never paste either value into chat, a commit or any
file.** Then **redeploy**, since secrets do not apply to a running version.

### Verify, and stop

1. `app.ikigaro.com` → Profile → Connected devices. **Oura should appear with a
   Connect button.**
2. Press Connect. The consent screen should now list **four** permissions:
   daily, heart rate, SpO2 and workout.
3. **Stop there. Do not approve**, there is no ring on the account.

**Four, not six, is correct.** Workout was added to the code in this round.
Stress and Heart Health are granted at the portal and still not requested,
because their OAuth scope strings are in no public documentation and a wrong
one fails the entire authorize request. The code fetches those collections
anyway and tolerates a refusal, so if they happen to ride on `daily` they simply
work. Written up in `../WEARABLES.md`.

**Do not touch `WEARABLE_TOKEN_KEY`, the Whoop or Ultrahuman secrets, or the
Ultrahuman connection**, which is healthy and syncing.

---

Two things are waiting on the founder rather than on Cowork:

- **The remaining wearable credentials.** Whoop is the pending task above.
  Oura and Fitbit are self-serve and their adapters have now been audited, so
  they are ready to register whenever there is an afternoon; the exact scopes
  to tick are in [`../WEARABLES_APPLICATIONS.md`](../WEARABLES_APPLICATIONS.md)
  and matter, since three of Fitbit's old six were dead. Withings is the one
  adapter still unaudited: do not register it before it has been read against
  their docs. Garmin is paused at their end indefinitely.
- **Supabase backups.** The production database is on the Free plan: no
  backups, no point-in-time recovery. Worst case is total loss. This is a
  spend decision (Pro, $25/mo), deliberately deferred until ~20 testers, not
  an oversight. It is the largest standing risk in the stack.

A note for whoever applies the next migration: on 0019 the SQL Editor's
"Running..." spinner froze and never cleared. Do not re-click Run. Check the
real database state from a second connection first, both that the change
landed and that nothing is still in flight or blocked. A frozen spinner says
nothing about whether the statement committed. Replacing this step with a CI
runner is on the deferred list in `../PROJECT_STATUS.md` §8.

## Later, as each provider's credentials arrive

When a vendor comes through, it is two commands and a deploy:

```bash
wrangler secret put OURA_CLIENT_ID
wrangler secret put OURA_CLIENT_SECRET
```

…and the same pair for `FITBIT_`, `WHOOP_`, `WITHINGS_`, `GARMIN_`,
`ULTRAHUMAN_`. Each provider appears in Settings on its own once both halves are
set. Nothing else to switch on.
