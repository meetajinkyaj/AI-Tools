# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-08-03. **One task is pending:** regenerate
`WEARABLE_TOKEN_KEY`, which is not valid base64 and has never worked, then
connect Ultrahuman. See [PENDING TASK](#pending-task) below.

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
| `WEARABLE_TOKEN_KEY` | Set on prod `ai-tools` 2026-07-30, but the value is **not valid base64**, so token encryption has never worked and nothing has ever been stored under it. Being regenerated, see the pending task. Not set on `ikigaro-reminders` or staging, correct. Note it is used two ways: base64-decoded as an AES key, and as a plain string to derive the OAuth state HMAC. Only the first was broken, which is why consent and callbacks worked throughout. |
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

## Regenerate `WEARABLE_TOKEN_KEY`, then connect Ultrahuman

**Read this first: the "do not touch `WEARABLE_TOKEN_KEY`" instruction from
earlier rounds is withdrawn.** It was right when it was given and its premise
turned out to be false. Rotating it now costs nothing.

### What the 503 actually proved

The guard's message is correct and the guard is not stricter than the decoder.
There is exactly **one** decoder in the codebase and both paths use it. So:

**The key is not base64. Encryption with it has never once worked.** Not before
the fix, not after. That is why the only connection row on production has no
tokens in it.

Which means the usual reason not to rotate, that every connected user would have
to reconnect, does not apply: **there is nothing encrypted under this key.**
`wearable_daily_metrics` has zero rows and the one connection row holds no
credentials. Rotating loses nothing.

The guard also did exactly its job. It refused **before** sending anyone to
Ultrahuman's consent screen, instead of after.

### 1. Generate a new key

Run this and copy the single line it prints:

```bash
openssl rand -base64 32
```

It must be the **base64** form, not `-hex`. A hex string decodes to 48 bytes and
the guard will reject it for the wrong length.

**Never paste the value into chat, a commit, or any file.** If you cannot set it
without the value passing through you, stop and hand the click path to the
founder.

### 2. Replace the secret

Cloudflare → Workers & Pages → **`ai-tools`** → Settings → Variables and Secrets
→ `WEARABLE_TOKEN_KEY` → Edit. Type **Secret**, not plaintext Variable.

**Then redeploy.** Secrets do not apply to an already-running version.

### 3. Connect

1. Profile → Connected devices. **Connect** should be enabled and clicking it
   should now go to Ultrahuman rather than showing "Device connections aren't
   available right now".
2. **Approve, briskly**, inside two minutes.
3. Then run the query. **Do not click "Sync now" first**, it overwrites the
   evidence.

```sql
select provider, status, failure_count, last_sync_at, connected_at, last_error,
       external_user_id is not null as has_external_id,
       access_token_enc is not null as has_access_token,
       refresh_token_enc is not null as has_refresh_token,
       expires_at
from wearable_connections
where provider = 'ultrahuman';
```

### What a healthy row looks like

| Column | Expected |
|---|---|
| `has_access_token` | **true**. This is the one that has never yet been true. |
| `has_refresh_token` | true |
| `expires_at` | roughly 24 hours out |
| `connected_at` | your new attempt, not `14:25:52` |
| `last_sync_at` | **set**, even with no ring |

**`last_sync_at` is the prize.** A sync that runs and finds nothing still stamps
it, so a set value confirms the metrics endpoint host, which is the last
unproven guess left in the adapter. Null with `last_error` populated means the
host is wrong: paste the error.

### If the 503 comes back

The message now says which of two things is wrong, and they need different
actions:

| Message | Meaning |
|---|---|
| `...it contains characters that are not base64 or base64url...` | The value is not base64. Something mangled it in transit. Generate again and re-paste carefully. |
| `...its length is not a valid base64 length, so it is probably truncated...` | It got cut off. Check the whole line was copied. |
| `...decoded to N bytes; AES-256 needs 32 bytes...` | Valid base64, wrong size. Almost always `-hex` instead of `-base64`. |

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
