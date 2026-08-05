# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-08-04. **One task is pending:** add the founder's WHOOP
account as a Test User on the Whoop app. See [PENDING TASK](#pending-task).

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
| Whoop, connect blocked | 2026-08-04. Secrets are set and valid, and Connect reaches Whoop's real sign-in. Whoop then returns `request_unauthorized` with no code, which is the development-mode test-user gate, not a credential or scope fault. See the pending task. |
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

## Add the founder's WHOOP account as a Test User on the Whoop app

**This is a dashboard change, not a code change.** The error text points the
wrong way, so read this before acting on it.

What came back from Whoop after sign-in:

```
error=request_unauthorized
error_description=The request could not be authorized
error_hint=Check that you provided valid credentials in the right format.
```

That reads like our client id or scope string is wrong. **It is not.** A
malformed scope returns `invalid_scope`, a member declining returns
`access_denied`, and neither is what came back. The same client id also got as
far as Whoop's sign-in page, which it could not do if Whoop did not recognise
it.

**A new Whoop app starts in development mode**, and in that mode only WHOOP
accounts explicitly added as **Test Users** can authorise it. Anyone else signs
in fine and is then bounced with exactly this error.

### What to do

1. `developer-dashboard.whoop.com` → team **Ikigaro** → app **Ikigaro**.
2. Find the section for **Test Users** (it may be called Test Members, Allowed
   Users, or sit under app settings or a Development/Access tab). If you cannot
   find it, say so and describe what tabs the app page does have, rather than
   guessing at another cause.
3. **Add the founder's own WHOOP account**, by the email their WHOOP membership
   is under.
4. Retry: `app.ikigaro.com` → Profile → Connected devices → Whoop → Connect →
   sign in.

**Expected:** a consent screen listing **exactly four** permissions, matching
`read:sleep`, `read:recovery`, `read:cycles` and offline access.

**Stop at the consent screen and report.** Do not approve unless the founder
actually has a WHOOP band, since an empty connection tells us nothing and costs
a reconnect to clear.

### The second possible cause, if test users does not fix it

Whoop's own overview opens with *"You must have a WHOOP membership to develop an
app on the Developer Platform."* An account with no active membership may not be
able to grant data scopes at all. If adding the test user changes nothing,
**check whether the founder's WHOOP account has an active membership**, and
report that rather than trying anything else.

### What NOT to do

**Do not suggest changing the authorize URL or the scope list.** Both were
audited against Whoop's published v2 documentation on 2026-08-04, and the four
scope strings are the ones Whoop publishes. The scope list is the first thing
that looks guilty here and it is not the cause.

`read:workout` being ticked on the app is harmless: our code decides what the
consent screen asks for, so that scope is granted but dormant.

**Do not touch `WEARABLE_TOKEN_KEY`, the Whoop secrets, or the Ultrahuman
connection**, which is healthy and syncing.

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
