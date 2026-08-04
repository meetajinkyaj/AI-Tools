# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-08-04. **One task is pending:** register the Whoop developer
App and set its two secrets. See [PENDING TASK](#pending-task) below.

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

## Register the Whoop developer App, and set its two secrets

Self-serve, no review, no queue. The founder is not technical, so **walk them
through it screen by screen rather than describing it**. Two values come out of
this and you must not handle either of them yourself.

### What you can do, and what you cannot

**You can:** navigate `developer.whoop.com`, read the forms aloud, say exactly
which boxes to tick, and confirm afterwards that Whoop appears in the app.

**You cannot:** create the Whoop account, and you must never take the Client
Secret. If a step cannot be done without the secret passing through you, stop
and hand the founder the exact click path instead.

### 1. Get into the dashboard

`developer.whoop.com` → sign in with the founder's WHOOP member account. It is
the same login as the WHOOP phone app; there is no separate developer signup.
If they have no WHOOP account, one has to be created first and that needs them.

Then: **Developer Dashboard** → **Create App**.

### 2. Fill the form

Read these out one at a time and let them type.

| Field | What to put |
|---|---|
| App name | `Ikigaro` |
| Contact email | the founder's email |
| Privacy policy | `https://app.ikigaro.com/privacy` |
| Redirect URI | `https://app.ikigaro.com/api/wearables/callback/whoop` |

**The redirect URI must match byte for byte.** No trailing slash, no `www`, all
lowercase. Every OAuth vendor rejects a mismatch with the same unhelpful
`invalid redirect_uri` and nothing else to go on. Copy it, do not retype it.

### 3. The scopes, which is the step that actually matters

**Tick exactly these four:**

- ☑ `read:sleep`
- ☑ `read:recovery`
- ☑ `read:cycles`
- ☑ `offline`

**Leave everything else unticked**, in particular:

- ☐ `read:profile` (returns the member's name and email, we never read it)
- ☐ `read:workout`
- ☐ `read:body_measurement`

Two reasons this is not a detail. **`offline` is load-bearing**: without it
Whoop issues no refresh token and every connection dies within the hour, which
looks like a broken integration a day later rather than a missed checkbox now.
And **the scope list must match the code** (`src/lib/wearables/providers.ts`),
because anything ticked here appears on the consent screen asking members for
access we never use.

Then **Create**.

### 4. The two credentials

Whoop shows a **Client ID** and a **Client Secret** immediately after creation.

**Do not paste either into chat, a commit, or any file. Do not read the secret
back to confirm it.** Tell the founder to copy them straight into Cloudflare,
and to save the secret in their password manager at the same time, because
Whoop may not show it again.

Cloudflare → Workers & Pages → **`ai-tools`** → Settings → **Variables and
Secrets** → Add:

| Name | Type |
|---|---|
| `WHOOP_CLIENT_ID` | **Secret** |
| `WHOOP_CLIENT_SECRET` | **Secret** |

**Type Secret, not plaintext Variable.** `wrangler.jsonc` declares the plaintext
vars and replaces them on every deploy, so a Variable would silently vanish at
the next push. Secrets survive. Same reason `RESEND_API_KEY` and
`WEARABLE_TOKEN_KEY` are Secrets.

**Then redeploy.** Secrets do not apply to an already-running version. Either
push any commit to `main` or use the dashboard's Deploy on the latest version.

### 5. Verify, and stop

1. `app.ikigaro.com` → **Profile** → **Connected devices**.
2. **Whoop should now appear with a Connect button.** Ultrahuman keeps its
   Disconnect. The other four stay button-less, since a provider only renders
   when both halves of its credentials exist. Whoop appearing and nothing else
   changing is the whole test.
3. Press **Connect**. It should reach Whoop's consent screen, which must list
   **exactly four permissions** matching the four ticked above.
4. **Stop there. Do not approve** unless the founder owns a Whoop band, since
   an empty connection tells us nothing and costs a reconnect to clear.

### What to report

- Did Whoop appear, and only Whoop?
- Did the consent screen load, and which permissions did it list?
- If it lists `read:profile` or anything else beyond the four, say so: the App
  was created with the wrong scopes and it is a two-minute fix in the dashboard.

### If it goes wrong

| Symptom | Cause |
|---|---|
| No Whoop in Connected devices | The redeploy did not happen, or a secret name is misspelled. Both names are case-sensitive with no prefix. |
| `invalid redirect_uri` at Whoop | The redirect URI does not match byte for byte. Compare it against the value above, character by character. |
| "Device connections aren't available right now" | Not a Whoop problem. That is the `WEARABLE_TOKEN_KEY` guard, and the Worker log line says exactly what is wrong with it. |

**Do not touch `WEARABLE_TOKEN_KEY`, and do not disconnect Ultrahuman.**

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
