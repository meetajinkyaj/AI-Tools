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

**No database work is pending.** Everything below is secrets and configuration.

---

# PENDING TASK — paste everything below the line into Cowork

---

Set up the secrets for Ikigaro's wearable integrations on the **production
Cloudflare Worker `ai-tools`**.

Nothing in the wearables feature works until these exist. There is no database
work — all migrations are already applied.

## The two secrets are handled DIFFERENTLY

They look alike and are not:

| Secret | Must anyone see it? | Goes where |
|---|---|---|
| `WEARABLE_TOKEN_KEY` | **No** — generate and pipe, never displayed | Worker `ai-tools` only |
| `GARMIN_PUSH_SECRET` | **Yes, once** — it goes inside a URL on Garmin's application form | Password manager **and** Worker `ai-tools` |

Do not print, echo, log or screenshot either value beyond what is unavoidable
for the second one. Do not put either in your report back.

### 1. `WEARABLE_TOKEN_KEY` — the switch that turns the feature on

Encrypts stored OAuth tokens and signs the OAuth `state` parameter.

From the repo root:

```bash
openssl rand -base64 32 | wrangler secret put WEARABLE_TOKEN_KEY
```

The value goes straight from `openssl` into Cloudflare — never a terminal, a
log, or shell history. Nobody needs to know it, so nobody should.

**Cloudflare secrets are write-only.** This cannot be read back. If lost,
everyone who had connected a device reconnects — which costs nothing today,
because there are zero connections. That is exactly why generating an unseeable
value now is the right trade. If you would rather keep a recoverable copy,
**ask first**; do not decide that alone.

### 2. `GARMIN_PUSH_SECRET` — needed to fill in Garmin's application form

Authenticates Garmin's push callbacks. Garmin does not sign its pushes, so
knowledge of the URL is the only thing separating a real one from a forged one.

**Generate it URL-safe — hex is the easiest way:**

```bash
openssl rand -hex 32
```

Any alphanumeric value works equally well. What matters is avoiding `+` and `/`
(see below), not hex specifically.

**Why URL-safe matters.** This value is read out of a URL query parameter, where a
literal `+` legally means a space. Base64 emits `+` about half the time, so a
base64 secret would arrive with spaces where plusses were, never match, and
every Garmin push would fail with a 404 that looks exactly like Garmin being
broken rather than a config error.

Then:

1. **Save it to the password manager** as "Ikigaro — Garmin push secret". It is
   needed again on Garmin's form, possibly weeks from now, and Cloudflare will
   not give it back.
2. `wrangler secret put GARMIN_PUSH_SECRET` and paste it when prompted.
3. The URL registered on Garmin's application form is:
   `https://app.ikigaro.com/api/wearables/garmin-push?key=<the value>`

## Which Worker — this matters

| Worker | Set these? |
|---|---|
| `ai-tools` (production) | **Yes**, both |
| `ikigaro-reminders` | **No.** It never touches tokens — it only calls the app with `CRON_SECRET`. |
| `ai-tools-staging` | Not now, and never a copy of production's values. |

## Verify — without revealing anything

```bash
wrangler secret list
```

Both names should appear. Cloudflare lists secret **names** only, never values.

Then load `app.ikigaro.com`, sign in, and open Settings. **What you should see
depends on whether PR #72 has been merged and deployed** — check that first:

**Before #72 is deployed:** the Settings screen shows NO device section at all.
That is correct and is not a failed secret. The shipped gate hides the whole
section until at least one provider has its client id and secret set, and none
do yet.

**After #72 is deployed:** a **"Connected devices"** section appears, listing
Apple Health and Google Health Connect under "Coming soon", with nothing
connectable. That is also correct — the token key switches the machinery on;
individual providers appear only as each one's credentials are added.

Either way the secrets are set correctly. If the observed state does not match
the deploy state, say so rather than assuming the secret failed — that
combination means something else is wrong.

## Do not

- Do not set either secret on `ikigaro-reminders`.
- Do not copy production values to staging.
- Do not commit them, put them in an `.env` file, or paste them into Supabase.
- Do not include either value, or any part of one, in your report back.

## Report back

- That both names appear in `wrangler secret list`
- That `GARMIN_PUSH_SECRET` is saved in the password manager, and that it
  contains no `+` or `/` (hex or plain alphanumeric both satisfy this)
- Whether PR #72 was deployed at the time you looked, and that what Settings
  showed matches the corresponding case above

No values, no partial values, no lengths.

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
