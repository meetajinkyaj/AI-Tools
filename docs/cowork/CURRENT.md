# Cowork — what's actually pending

**One file, always.** When a task here is done, delete it from this file rather
than adding a "completed" note. A folder of finished prompts is a pile nobody
reads and a trap for whoever re-runs one by accident. The permanent record of
what was applied lives in the "Already applied" ledger at the bottom — one line
each, no instructions.

Last updated: 2026-07-30.

---

## Already applied — do NOT re-run

| Migration | Status |
|---|---|
| `0013_points_rank_split` | Applied to production 2026-07-28, verified. Backfills matched per user (`iki_score` == ledger earned, `best_streak` == check-in peak), triggers live, all user codes adopted into `invite_codes`. |
| `0014_rls_on_partners_and_invite_codes` | Applied 2026-07-28, verified. RLS on both tables, no policies, schema-wide sweep clean. |
| `0015_wearable_connections` | Applied 2026-07-30, verified. Both tables live, RLS on with no policies, idempotency index present, no rows touched. |

| Configuration | Status |
|---|---|
| `WEARABLE_TOKEN_KEY` | Set on prod Worker `ai-tools` 2026-07-30 via the Cloudflare dashboard, verified present as a Secret. Not set on `ikigaro-reminders` or staging — correct. |
| `GARMIN_PUSH_SECRET` | Set on prod `ai-tools` 2026-07-30, URL-safe alphanumeric, saved to the founder's password manager. Needed again on Garmin's application form. |

**No database work is pending, and both base secrets are set.**

---

# PENDING TASK — paste everything below the line into Cowork

---

Confirm the wearables UI is live on production now that PR #72 has been merged
and deployed.

Background: the two base secrets (`WEARABLE_TOKEN_KEY`, `GARMIN_PUSH_SECRET`)
are already set on the `ai-tools` Worker. No provider credentials exist yet —
those come from vendor application forms that are still in progress.

## What to check

Load `app.ikigaro.com`, sign in, and open Settings.

**Expected:** a **"Connected devices"** section, containing:
- the intro line "Wearable device syncing is coming soon."
- a **Coming soon** group listing **Apple Health** and **Google Health Connect**
- **nothing connectable** — no Connect buttons, because no provider has its
  client id and secret set yet

Also open **Home**. Expect a **"Your devices"** card saying "Wearable device
syncing is coming soon." with a dismiss ✕ and no Connect button.

**This is the complete and correct state.** No Connect buttons is not a failure
— providers appear one at a time as each vendor's credentials arrive.

## If you see something different

- **No "Connected devices" section at all** → the deploy has not landed yet.
  Check the latest CI run on `main` finished, wait, and re-check.
- **A Connect button for some provider** → unexpected, since no provider
  credentials are set. Report which provider.
- **A console error mentioning `wearables`** → report the exact text.

## Do not

- Do not add any provider credentials — those are not available yet.
- Do not paste any keys, tokens or connection strings into chat.

## Report back

Whether both surfaces match the expected state, and the exact text of anything
that differs.

---

## Later, as each provider's credentials arrive

Not a task yet — it needs credentials from the vendor application forms first
(see [`../WEARABLES_APPLICATIONS.md`](../WEARABLES_APPLICATIONS.md)). When one
comes through, it is two commands and a deploy:

```bash
wrangler secret put OURA_CLIENT_ID
wrangler secret put OURA_CLIENT_SECRET
```

…and the same pair for `FITBIT_`, `WHOOP_`, `WITHINGS_`, `GARMIN_`,
`ULTRAHUMAN_`. Each provider appears in Settings on its own once both halves are
set. Nothing else to switch on.
