# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-08-03. **One task is pending:** read the Worker log line
that says why the Ultrahuman token exchange is failing. See
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
| `ULTRAHUMAN_CLIENT_ID` / `ULTRAHUMAN_CLIENT_SECRET` | Set on prod `ai-tools` 2026-08-03 as Secrets. Confirmed working for the authorize half: consent renders and returns a valid `code`. The token exchange then fails, which is the open task below. |
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

## Find out why the Ultrahuman token exchange is failing

**The secrets are set and the authorize half works.** Consent returns a valid
`code` to `/api/wearables/callback/ultrahuman`, which only happens when the
client id, the scopes and the redirect URI are all accepted. The callback then
redirects to `/?wearable=failed&provider=ultrahuman`.

**The reason is already in the logs. It is not swallowed.** Read this before
changing anything: the previous session's report said the failure is logged
without a reason, and that is not what the code does.
[`callback/[provider]/route.ts`](../../src/app/api/wearables/callback/[provider]/route.ts)
catches and calls `console.error`, `wrangler.jsonc` has `observability.enabled`,
and `requestTokens` in
[`sync.ts`](../../src/lib/wearables/sync.ts) puts the HTTP status and the first
200 characters of Ultrahuman's own response body into the error message. So
Ultrahuman's exact complaint is already being written to the Worker logs. **No
code change is needed to diagnose this.**

### Step 1: read the log line

In Cloudflare, Workers & Pages → `ai-tools` → **Observability → Logs**, search
the window covering the failed attempt for:

```
wearable callback
```

Exactly one of two lines will be there, and which one it is decides everything:

| Line | Meaning |
|---|---|
| `wearable callback failed for ultrahuman: <message>` | The token exchange ran and Ultrahuman rejected it. **The message contains their status code and response body.** Paste it verbatim. |
| `wearable callback rejected for ultrahuman before exchange: <reason>` | It never got as far as the exchange. Reason is one of `no-code`, `bad-or-expired-state`, `provider-mismatch`. |

**`bad-or-expired-state` is the likely one if the consent screen sat open.** The
signed state has a **15 minute TTL**, so approving after a pause fails exactly
this way and looks identical in the browser to a broken integration. It is not
one. Just retry the whole flow briskly, Connect through to Approve inside a
couple of minutes.

**If neither line appears at all**, the log retention window has rolled past the
attempt. Retry the flow once and look again immediately.

### Step 2: report, do not fix

Send back the exact line. Nothing beyond that. Each reason points at a different
fix and three of the four are one-line code changes that belong in the repo, not
in the dashboard:

- `401` / `invalid_client` → the client secret value. Re-copy both halves from
  the Ultrahuman portal, watching for a trailing newline or the two being
  swapped, re-enter as Secrets, redeploy, retry.
- `404` → the token **host** is wrong. This is the one thing we recorded as
  unverified: their docs give the path `/api/partners/oauth/token` without
  repeating the host, and we assumed `partner.ultrahuman.com`. A code fix.
- `invalid_grant` / `invalid_request` → the exchange parameters. A code fix.
- `bad-or-expired-state` → not a bug. Retry faster.

**Do not add logging, edit the Worker's code, or try alternative hosts.** The
information needed is already being written; the job here is to read it.

### If it turns out to be the secret values

Re-entering them is fine and is the cheap first test when the log says `401` or
`invalid_client`. Same rules as before: type **Secret**, not plaintext Variable
(`wrangler.jsonc` replaces plaintext vars on every deploy), and **never paste
either value into chat, a commit, or any file.** Redeploy afterwards, secrets do
not apply to an already-running version.

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
