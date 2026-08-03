# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-08-03. **One task is pending:** read why the first
Ultrahuman sync did not stamp `last_sync_at`. The connect itself works. See
[PENDING TASK](#pending-task) below.

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
| First real wearable connection | Ultrahuman OAuth completed end to end 2026-08-03 on `app.ikigaro.com`. Tokens exchanged and stored, card shows Disconnect, zero errors in the Worker logs after the fix deployed. This also proves the token host and path, the `/authorise` spelling, the three scope strings and the redirect URI, all of which were previously guesses. The metrics endpoint is still unproven. |
| Wearables UI on production | Confirmed live 2026-07-30 on `app.ikigaro.com`. Settings shows **Connected devices** with the coming-soon copy and Apple Health / Google Health Connect listed; Home shows the **Your devices** card. No Connect buttons on either surface, correct, since no provider credentials exist yet. Dismiss ✕ persists across reload. No app console errors. |

| Repo hygiene | Status |
|---|---|
| Branch cleanup | 2026-07-30: all 30 stale branches deleted, leaving only `main`. **"Automatically delete head branches" is now enabled** in Settings → General, so merged PRs clean up after themselves, do not let this pile up again. |

**No database work is pending, and the UI is verified live.** Ultrahuman's
OAuth app is registered and its consent screen works; only the token exchange
is outstanding.

---

# PENDING TASK

## Read why the first Ultrahuman sync did not complete

**The connect itself is done and working, do not retry it.** OAuth completed on
2026-08-03, tokens are stored, and the card shows Disconnect. That half is
finished and needs nothing further.

**The open question is the subtext "not synced yet".** That string means one
thing exactly: `wearable_connections.last_sync_at` is null. It is not a neutral
"no data yet" message. A sync that ran and found nothing, which is the expected
result with no ring on the account, **still stamps `last_sync_at`**. A null
stamp means the sync did not finish.

**Nothing about this is in the Worker logs, and that is by design.** Sync
failures are written to the connection row rather than to the console, so that
one user's dead grant cannot flood the logs during the nightly sweep. So "0
errors in Observability" is consistent with a failed sync and does not rule one
out.

### The query

Supabase → SQL Editor. Read-only, changes nothing:

```sql
select provider,
       status,
       failure_count,
       last_sync_at,
       connected_at,
       last_error,
       external_user_id is not null as has_external_id,
       access_token_enc is not null as has_access_token,
       refresh_token_enc is not null as has_refresh_token,
       expires_at
from wearable_connections
where provider = 'ultrahuman';
```

Then, to see whether anything at all landed:

```sql
select count(*) as rows, min(metric_date) as oldest, max(metric_date) as newest
from wearable_daily_metrics
where provider = 'ultrahuman';
```

### What to report

The full first row, **except** `last_error` needs care: paste it verbatim, but
if it contains anything that looks like a token or a long random string, replace
that part with `...`. It should not, the message is a status code and the first
200 characters of Ultrahuman's response body, but check before pasting.

### What each answer means, so you know what you are looking at

| What you see | Reading |
|---|---|
| `last_sync_at` set after all | The UI was stale when checked. Nothing is wrong. Say so. |
| `status = 'expired'`, `last_error` mentions reauth | The stored token could not be used. Serious, and the opposite of what the successful connect implies. |
| `last_error` contains `404` | Likely the metrics **host** or path, the one thing still recorded as unproven. A code fix, not a dashboard fix. |
| `failure_count = 1` with some other message | Whatever the message says. Send it. |
| `last_error` null and `last_sync_at` null | The immediate post-connect sync never ran at all. Also a code question. |

**Do not click "Sync now", change code, or touch any secret.** Clicking Sync now
overwrites `last_error` with a fresh attempt and destroys the evidence from the
connect. Read the row first.

### Not needed: a clean Disconnect and reconnect

You offered one. Skip it, and your reasoning for hesitating was right. It would
cost a real reconnect to re-prove something already proven, and it would clear
the very row we now want to read.

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
