# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-08-07. **Nothing is pending.** The last three tasks came
back the same day: Oura is reconnected with the workout scope, the duplicate
Ultrahuman rows were two different accounts and not a fault, and Oura's revoke
URL has been read off their page and implemented.

**The Fitbit registration task is withdrawn**, and not because it was done.
Cowork found that `dev.fitbit.com` has closed registration for new
applications and that the legacy Fitbit Web API is deprecated in September
2026: Fitbit now runs through the Google Health API. Nobody can complete that
task as it was written. Registration has to follow a rewritten adapter, so it
comes back as a task when there is code for it to match. Good catch, it would
have cost an afternoon and produced credentials nothing could call.

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
| `0021_workout_auto_detected` | Applied to production 2026-08-06 and verified twice. `wearable_workouts.auto_detected` present, `boolean`, not null, default `false`; 0 rows flagged. Records whether the member started a session or their device noticed it, which is what keeps an auto-logged walk out of the training-day count without discarding it. |
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
| Oura reconnected with the workout scope | **2026-08-07.** The old grant held three scopes and could never return a workout, and an OAuth grant cannot gain a permission after the fact. Disconnected and reconnected; the consent screen listed **four** permissions (Sleep/Readiness/Activity, Heart Rate, SpO2, Workout Data), which was the tripwire, three would have meant production was behind main. The new row carries `extapi:daily extapi:heartrate extapi:spo2 extapi:workout`, status active, both tokens stored, expiring 2026-09-06. One row: the upsert replaced the old grant rather than duplicating it. Note Oura returns granted scopes prefixed `extapi:` where we request them bare. **This is the first provider ever able to return a workout.** |
| Duplicate Ultrahuman rows | **2026-08-07, not a fault.** Two different `user_id` values, so two accounts each connected their own Ultrahuman. The unique index `wearable_connections_user_provider_key on (user_id, provider)` makes a genuine duplicate impossible, and the query confirmed the index is doing its job rather than missing. Worth having asked: a real duplicate would have been serious, since Ultrahuman rotates refresh tokens and two rows refreshing one grant would each invalidate the other's token. |
| Oura revoke URL | **2026-08-07, read off `api.ouraring.com/docs/authentication` by hand** because every automated extractor strips the code block containing it. `https://api.ouraring.com/oauth/revoke?access_token={access_token}`, no HTTP method stated, and only `access_token` in the URL despite the prose mentioning `client_id`. Both gaps are handled in the adapter rather than guessed: POST first with a GET retry, and only the parameter their example shows. Disconnect now revokes at Fitbit, Whoop and Oura. |
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

**Nothing is pending.** All three queued tasks came back on 2026-08-07 and
their answers are in the ledger above. The next one will appear here when there
is one; do not go looking for work in the older sections, they are a record of
what was already done.

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
