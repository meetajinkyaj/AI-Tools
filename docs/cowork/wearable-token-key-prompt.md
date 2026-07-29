# Cowork prompt — generate and set `WEARABLE_TOKEN_KEY`

Paste everything below the line into Claude Cowork.

---

Generate and set a new secret called `WEARABLE_TOKEN_KEY` on the **production
Cloudflare Worker `ai-tools`** for Ikigaro.

This key encrypts the OAuth tokens for wearable connections (Oura, Fitbit,
Whoop, Withings, Garmin, Ultrahuman) and signs the OAuth `state` parameter.
Nothing about the feature works until it exists.

## Never reveal the value

**Do not print, echo, log, screenshot, or repeat this secret anywhere — not in
chat, not in a file, not in a commit.** The preferred method below is written
so the value is never displayed at all: it is piped straight from `openssl`
into `wrangler` and never touches a terminal that anyone reads.

If you end up on the dashboard path and the value must briefly exist in order to
be pasted into Cloudflare's secret field, that is acceptable — a secret field is
what it is for — but do not restate it afterwards, and do not put it in your
summary.

## Method A — preferred, the value is never visible

From the repo root (`wrangler.jsonc` for the `ai-tools` Worker is there):

```bash
openssl rand -base64 32 | wrangler secret put WEARABLE_TOKEN_KEY
```

That is the whole thing. `openssl` generates 32 random bytes, base64-encodes
them, and pipes them straight into Cloudflare. The value never appears on
screen, in shell history, or in any log.

## Method B — dashboard, if wrangler is not authenticated

1. Cloudflare dashboard → Workers & Pages → **`ai-tools`** → Settings →
   Variables and Secrets
2. Add variable, type **Secret** (encrypted), name `WEARABLE_TOKEN_KEY`
3. For the value, generate 32 random bytes as base64 — `openssl rand -base64 32`
   in any terminal — and paste it into the secret field
4. Save and deploy

## Which Worker — this matters

| Worker | Set it? |
|---|---|
| `ai-tools` (production) | **Yes** — this is the one |
| `ikigaro-reminders` | **No.** It never touches tokens; it only calls the app with `CRON_SECRET`. Setting it there is harmless but misleading. |
| `ai-tools-staging` | Not now. Only if we later want to test wearables on staging, and it should get its **own different key**, not a copy of production's. |

## Verify — without revealing anything

```bash
wrangler secret list
```

Expect `WEARABLE_TOKEN_KEY` to appear in the list. Cloudflare shows secret
**names** only, never values — that is the correct check and the only one
available.

Then confirm the app still loads normally: open `app.ikigaro.com`, sign in, and
open Settings.

**You should see NO new section.** That is the expected and correct result, not
a failure. The "Connected devices" section only appears once at least one
provider also has its client id and secret configured, and none do yet. The key
switches the machinery on; the providers switch the UI on.

## One thing worth knowing before you run it

**Cloudflare secrets are write-only.** Once set, the value cannot be read back —
not through the dashboard, not through the CLI. If it is ever lost, the only
path is to set a new one, and every user who had connected a device would have
to reconnect.

Right now that costs nothing: there are zero wearable connections. So generating
a value nobody ever sees (Method A) is the right trade today.

If you would rather keep a recoverable copy for later — so a future key rotation
or a staging setup does not force everyone to reconnect — generate it yourself
first, store it in a password manager, and then use Method B. Ask before
choosing that path; do not decide it unilaterally.

## Do not

- Do not set this on the `ikigaro-reminders` Worker.
- Do not copy production's key to staging.
- Do not commit it, put it in an `.env` file, or paste it into Supabase.
- Do not include the value in your report back.

## Report back

- Which method you used
- That `WEARABLE_TOKEN_KEY` appears in `wrangler secret list`
- That the app loads and Settings shows no new section (which is correct)

Nothing else. No value, no partial value, no length.
