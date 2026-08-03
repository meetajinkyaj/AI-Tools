# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-08-03. **One task is pending:** reconnect Ultrahuman once,
after the shell-row fix deploys. See [PENDING TASK](#pending-task) below.

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
| `WEARABLE_TOKEN_KEY` | Set on prod Worker `ai-tools` 2026-07-30 via the Cloudflare dashboard, verified present as a Secret. Not set on `ikigaro-reminders` or staging, correct. |
| `GARMIN_PUSH_SECRET` | Set on prod `ai-tools` 2026-07-30, URL-safe alphanumeric, saved to the founder's password manager. Needed again on Garmin's application form. |
| `RESEND_API_KEY` | Set on prod `ai-tools` 2026-07-30 as a **Secret** (survives deploys, plaintext vars are replaced by `wrangler.jsonc` on every deploy). Sending-access-only key, scoped to `ikigaro.com`. |
| Resend domain | `ikigaro.com` verified 2026-07-30 as the **root** domain (not `send.ikigaro.com`), so `From: team@ikigaro.com` is valid. Records are subdomain-scoped in Cloudflare; the existing Hostinger SPF/MX/DKIM/DMARC were left untouched and no second SPF was added. |
| `ULTRAHUMAN_CLIENT_ID` / `ULTRAHUMAN_CLIENT_SECRET` | Set on prod `ai-tools` 2026-08-03 as Secrets. Confirmed working: consent renders, returns a valid `code`, and the token exchange succeeds. The connect failure traced to `WEARABLE_TOKEN_KEY` being decoded with a strict `atob`, not to these credentials. Do not re-enter or rotate them. |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | **Deliberately unset, do not add them.** The code defaults to `Ajinkya from Ikigaro <team@ikigaro.com>`, a real Hostinger mailbox that receives, so replies go to `From` by default. Setting these as dashboard plaintext vars would be wiped on the next deploy anyway. |

| Verification | Status |
|---|---|
| First real wearable connection | **Not yet achieved.** The `atob` fix deployed clean, but the row on production turned out to be the pre-fix failed attempt: a shell with `status = 'active'` and no credentials, which the card rendered as Disconnect. Found by reading `connected_at`, which the upsert refreshes and which had not moved. The token host, `/authorise` spelling, scope strings and redirect URI are still proven by the successful code exchange that preceded the encryption failure. The metrics endpoint remains unproven. |
| Wearables UI on production | Confirmed live 2026-07-30 on `app.ikigaro.com`. Settings shows **Connected devices** with the coming-soon copy and Apple Health / Google Health Connect listed; Home shows the **Your devices** card. No Connect buttons on either surface, correct, since no provider credentials exist yet. Dismiss ✕ persists across reload. No app console errors. |

| Repo hygiene | Status |
|---|---|
| Branch cleanup | 2026-07-30: all 30 stale branches deleted, leaving only `main`. **"Automatically delete head branches" is now enabled** in Settings → General, so merged PRs clean up after themselves, do not let this pile up again. |

**No database work is pending, and the UI is verified live.** Ultrahuman's
OAuth app is registered and its consent screen works; only the token exchange
is outstanding.

---

# PENDING TASK

## Reconnect Ultrahuman once, after the shell-row fix deploys

**Your read was right, and it found a real bug.** The row you queried was the
**pre-fix failed attempt**, not a successful connect. `connected_at` is part of
the upsert payload, so a successful reconnect would have refreshed it; it did
not, which means no successful connect ever ran.

What the old code did: wrote the connection row, then wrote the tokens as a
**second statement**. Encryption threw in between. Production was left with a
row saying `status = 'active'` and no credentials at all. The card rendered
**Disconnect**, nothing could ever sync, and `last_error` stayed null because no
sync had failed. It looked like success from every angle.

Both halves are now fixed: the credentials are encrypted first and written in
the **same statement** as the row, so no half-connection can exist; and a row
with no access token is filtered out of the connections API, so the existing
shell row reads as "not connected" rather than offering a Disconnect button for
nothing.

### What to do

1. **Confirm the deploy.** `ai-tools` → Deployments, active version includes
   "Write a wearable connection and its credentials in one statement".
2. **Load Profile → Connected devices.** Ultrahuman should now show
   **Connect**, not Disconnect. That is the shell row correctly disappearing.
3. **Connect → Approve**, briskly, inside two minutes.
4. **Then re-run the same query as last time.**

```sql
select provider, status, failure_count, last_sync_at, connected_at, last_error,
       external_user_id is not null as has_external_id,
       access_token_enc is not null as has_access_token,
       refresh_token_enc is not null as has_refresh_token,
       expires_at
from wearable_connections
where provider = 'ultrahuman';
```

### What a healthy row looks like now

| Column | Expected |
|---|---|
| `has_access_token` | **true**. If this is false again, stop and report: the fix did not take. |
| `has_refresh_token` | true |
| `expires_at` | roughly 24 hours out |
| `connected_at` | your new attempt, not `14:25:52` |
| `last_sync_at` | **set**, even with no ring |

**`last_sync_at` is the one to watch.** A sync that runs and finds nothing still
stamps it. If it is set, the metrics endpoint host is confirmed too, which is
the last unproven guess in the adapter. If it is null with `last_error`
populated, paste the error: that is the metrics host, and a code fix.

### Also worth a quick look

There is now a **confirmation dialog** on Disconnect. If you happen to tap it,
Cancel should close it and change nothing. Do not confirm it.

**Do not click "Sync now" before running the query**, it overwrites the evidence
from the connect.

---

Two things are waiting on the founder rather than on Cowork:

- **The remaining wearable credentials.** Oura, Fitbit, Whoop and Withings are
  self-serve and take an afternoon each. Garmin is paused at their end
  indefinitely. See
  [`../WEARABLES_APPLICATIONS.md`](../WEARABLES_APPLICATIONS.md).
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
