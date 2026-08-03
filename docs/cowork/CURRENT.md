# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-08-03. **One task is pending:** redeploy and retry the
Ultrahuman connect. The failure is diagnosed and fixed in code. See
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
| Wearables UI on production | Confirmed live 2026-07-30 on `app.ikigaro.com`. Settings shows **Connected devices** with the coming-soon copy and Apple Health / Google Health Connect listed; Home shows the **Your devices** card. No Connect buttons on either surface, correct, since no provider credentials exist yet. Dismiss ✕ persists across reload. No app console errors. |

| Repo hygiene | Status |
|---|---|
| Branch cleanup | 2026-07-30: all 30 stale branches deleted, leaving only `main`. **"Automatically delete head branches" is now enabled** in Settings → General, so merged PRs clean up after themselves, do not let this pile up again. |

**No database work is pending, and the UI is verified live.** Ultrahuman's
OAuth app is registered and its consent screen works; only the token exchange
is outstanding.

---

# PENDING TASK

## Redeploy, then retry the Ultrahuman connect

**The cause is found and fixed in code. It was never Ultrahuman.**

The log line you pulled was the whole answer:

```
wearable callback failed for ultrahuman: InvalidCharacterError: atob() called
with invalid base64-encoded data.
```

That is not the vendor rejecting us. **The token exchange had already
succeeded.** The throw came from `encryptToken`, one step later, while decoding
`WEARABLE_TOKEN_KEY` so the tokens could be stored. `atob` on Workers rejects
the base64url alphabet (`-`, `_`) and unpadded input, and the key is spelled in
a form it refuses. Ultrahuman was never the problem, and neither were the client
id, the secret, the redirect URI or the state.

**The decoder now folds base64url and pads, so the existing key works as-is.**
Nothing needs re-entering, regenerating or rotating. Do not touch
`WEARABLE_TOKEN_KEY`: rotating it would cost every connected user a reconnect
for no reason.

### What to do

1. **Confirm the fix is deployed.** Cloudflare → Workers & Pages → `ai-tools` →
   Deployments. The active version must include the commit
   "Decode the wearable key the way every other decoder here does".
2. **Retry the connect.** `app.ikigaro.com` → Profile → Connected devices →
   Ultrahuman → Connect → Approve.
3. **Expected:** the button becomes **Connected**, and the card shows
   Ultrahuman with no data. **An empty connection is the correct result**, there
   is no ring on the account yet.

### What to report

- Did the button flip to Connected?
- Search Observability → Logs for `wearable` and paste anything at level
  `error`. There should be none.

**If it fails again**, the log now distinguishes the cases properly, so send the
exact line and nothing else:

| Line | Meaning |
|---|---|
| `wearable connect refused: WEARABLE_TOKEN_KEY ...` | The key is genuinely unusable, not merely oddly spelled. The message says whether it failed to decode or decoded to the wrong length. It never contains the key. |
| `wearable callback rejected for ultrahuman before exchange: ...` | Never reached the exchange. One of `no-code`, `bad-or-expired-state`, `provider-mismatch`. |
| `wearable callback failed for ultrahuman: ...` | The exchange ran and something after it failed. The message carries the vendor's status and response body. |

**Do not change code, add logging, or edit secrets.** Report the line.

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
