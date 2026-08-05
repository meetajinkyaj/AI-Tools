# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-08-04. **Two tasks are pending:** read why the Whoop connect
returned without a consent screen, then reconnect Ultrahuman. See
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
| `WEARABLE_TOKEN_KEY` | **Regenerated 2026-08-04** and verified working: tokens now encrypt and store. The original value set 2026-07-30 was not valid base64, so encryption had never once worked and nothing was ever stored under it, which is why rotating cost nothing. Not set on `ikigaro-reminders` or staging, correct. Note it is used two ways: base64-decoded as an AES key, and as a plain string to derive the OAuth state HMAC. Only the first was ever broken, which is why consent and callbacks worked throughout. |
| `GARMIN_PUSH_SECRET` | Set on prod `ai-tools` 2026-07-30, URL-safe alphanumeric, saved to the founder's password manager. Needed again on Garmin's application form. |
| `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` | Set on prod `ai-tools` 2026-08-04 as Secrets, and verified: Whoop renders a Connect button and reaches Whoop's real sign-in with no 503. The App is `Ikigaro` under team `Ikigaro` at developer-dashboard.whoop.com. Scopes ticked there include `read:workout`, which the code does not request, so it is granted-but-dormant and harmless. `offline` has no dashboard checkbox and is requested in the authorize URL, which is correct. |
| `RESEND_API_KEY` | Set on prod `ai-tools` 2026-07-30 as a **Secret** (survives deploys, plaintext vars are replaced by `wrangler.jsonc` on every deploy). Sending-access-only key, scoped to `ikigaro.com`. |
| Resend domain | `ikigaro.com` verified 2026-07-30 as the **root** domain (not `send.ikigaro.com`), so `From: team@ikigaro.com` is valid. Records are subdomain-scoped in Cloudflare; the existing Hostinger SPF/MX/DKIM/DMARC were left untouched and no second SPF was added. |
| `ULTRAHUMAN_CLIENT_ID` / `ULTRAHUMAN_CLIENT_SECRET` | Set on prod `ai-tools` 2026-08-03 as Secrets. Confirmed working: consent renders, returns a valid `code`, and the token exchange succeeds. The connect failure traced to `WEARABLE_TOKEN_KEY` being decoded with a strict `atob`, not to these credentials. Do not re-enter or rotate them. |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | **Deliberately unset, do not add them.** The code defaults to `Ajinkya from Ikigaro <team@ikigaro.com>`, a real Hostinger mailbox that receives, so replies go to `From` by default. Setting these as dashboard plaintext vars would be wiped on the next deploy anyway. |

| Verification | Status |
|---|---|
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

## Find out why the Whoop connect returned without a consent screen

Whoop is registered, both secrets are set, and pressing Connect reaches Whoop's
real sign-in. After signing in the browser came **back to the app with no
consent screen and no `whoop` row**. That is the open question.

**Read the logs before touching anything.** Cloudflare → Workers & Pages →
`ai-tools` → Observability → Logs, search:

```
wearable
```

Exactly one of these lines will be there, and each means something different:

| Line | Meaning |
|---|---|
| `wearable callback failed for whoop: <message>` | The exchange ran and something after it failed. The message carries Whoop's status and response body. Paste it verbatim. |
| `wearable callback rejected for whoop before exchange: bad-or-expired-state` | The signed state expired. It has a 15 minute TTL, so a slow sign-in does this. **Not a bug.** Retry the whole flow briskly. |
| `wearable callback rejected for whoop before exchange: no-code` | Whoop redirected back without an authorization code, which usually means the member declined or the scope list was rejected. |
| Nothing at all | The browser never reached our callback, so the problem is at Whoop's end. Send the full URL from the address bar at the moment it came back. |

**Report the exact line and stop.** Do not add logging, change code, or edit
secrets. Each cause has a different fix and three of the four are code changes.

## Then: reconnect Ultrahuman

`wearable_connections` is empty, so Ultrahuman needs connecting again. This is
**not** the migration truncate it was thought to be: no migration in the repo
drops, truncates or deletes from that table, `0015` creates it with
`create table if not exists`, and no migration has been applied since `0019`.

**The only code path that removes a row is `DELETE /api/wearables`**, which is
what the Disconnect button calls, and it deletes outright by design. So the row
went because Disconnect was pressed. Nothing is wrong and nothing is at risk on
the next deploy.

1. `app.ikigaro.com` → Profile → Connected devices → Ultrahuman → Connect →
   Approve, briskly.
2. Confirm the card shows Disconnect and a sync time.

**Do not press Disconnect again** unless you mean it: it is a real
disconnection, not a UI reset, and reconnecting costs a trip through the
vendor's consent screen.

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
