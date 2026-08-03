# Cowork, what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger below, one line each,
no instructions.

Last updated: 2026-08-03. **One task is pending:** set the two Ultrahuman
Worker secrets. See [PENDING TASK](#pending-task) below.

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
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | **Deliberately unset, do not add them.** The code defaults to `Ajinkya from Ikigaro <team@ikigaro.com>`, a real Hostinger mailbox that receives, so replies go to `From` by default. Setting these as dashboard plaintext vars would be wiped on the next deploy anyway. |

| Verification | Status |
|---|---|
| Wearables UI on production | Confirmed live 2026-07-30 on `app.ikigaro.com`. Settings shows **Connected devices** with the coming-soon copy and Apple Health / Google Health Connect listed; Home shows the **Your devices** card. No Connect buttons on either surface, correct, since no provider credentials exist yet. Dismiss ✕ persists across reload. No app console errors. |

| Repo hygiene | Status |
|---|---|
| Branch cleanup | 2026-07-30: all 30 stale branches deleted, leaving only `main`. **"Automatically delete head branches" is now enabled** in Settings → General, so merged PRs clean up after themselves, do not let this pile up again. |

**No database work is pending, both base secrets are set, and the UI is
verified live.**

---

# PENDING TASK

## Set the two Ultrahuman secrets on the production Worker

The founder has both values in hand from the Ultrahuman developer portal
(`vision.ultrahuman.com`, app named `ikigaro`). Nothing else is needed to make
Ultrahuman appear in the app.

**Where:** Cloudflare dashboard → Workers & Pages → **`ai-tools`** → Settings →
Variables and Secrets.

**Add two, both as type Secret, not as plaintext Variable:**

| Name | Where the value comes from |
|---|---|
| `ULTRAHUMAN_CLIENT_ID` | Ultrahuman portal → OAuth Applications → `ikigaro` |
| `ULTRAHUMAN_CLIENT_SECRET` | same page, the secret half |

**Secret, not Variable, and this matters.** `wrangler.jsonc` declares the
plaintext vars, so anything added to the dashboard as a Variable is wiped on the
next deploy. Secrets are not in that file and survive. This is the same reason
`RESEND_API_KEY` and `WEARABLE_TOKEN_KEY` are Secrets.

**Do not paste either value into chat, a commit, or any file.** Cowork should
not handle them at all: if the dashboard step cannot be done without seeing the
values, stop and hand the click-path back to the founder instead.

**Then redeploy** so the Worker picks them up. Either push any commit to `main`,
or use the dashboard's "Deploy" on the latest version. Secrets do not apply to
an already-running version.

### How to verify, without a ring

1. Open `https://app.ikigaro.com/settings` as an approved user.
2. Under **Connected devices**, **Ultrahuman** should now be listed **with a
   Connect button**. The other five stay button-less: a provider only renders
   its Connect button when both halves of its credentials exist. Ultrahuman
   appearing and nothing else changing is the whole test.
3. Click Connect. It should bounce to `auth.ultrahuman.com` and show a real
   consent screen naming `ikigaro` and three permissions: **Profile**, **Ring
   Data**, **CGM Data**.
4. **Stop there and report back. Do not complete the consent.** There is no ring
   on the account yet, so a connection would be an empty one, and the useful
   information is entirely in what the consent screen says.

### What to report

- Did the Connect button appear for Ultrahuman, and only for Ultrahuman?
- Did the consent screen load, or did it 404?
- Exactly which permissions it lists.

**If the consent page 404s**, the likely cause is the authorize path spelling.
Ultrahuman's spec text says `/authorize` while every worked example uses
`/authorise`, and we follow the examples. Report the 404 with the full URL from
the address bar rather than trying alternatives; it is a one-line change here.

**If the button does not appear**, the redeploy did not happen or a name is
misspelled. Both names are case-sensitive and take no prefix.

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
