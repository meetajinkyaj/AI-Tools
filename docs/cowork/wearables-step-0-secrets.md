# Cowork prompt — Step 0: generate the two wearable secrets

Do this before touching any provider application form. `GARMIN_PUSH_SECRET` has
to exist before you can fill in Garmin's form, because it goes inside the push
URL you register with them.

Paste everything below the line into Claude Cowork.

---

Step 0 of the Ikigaro wearable rollout: generate and place two secrets.

**These two are handled DIFFERENTLY.** They look alike and are not:

| Secret | Must anyone ever see it? | Where it goes |
|---|---|---|
| `WEARABLE_TOKEN_KEY` | **No** — generate and pipe, never displayed | Cloudflare Worker `ai-tools` only |
| `GARMIN_PUSH_SECRET` | **Yes, once** — it goes inside a URL on Garmin's form | Password manager **and** Worker `ai-tools` |

Do not print, echo, log or screenshot either value beyond what is unavoidable
for the second one, and do not put either in your report back.

## 1. `WEARABLE_TOKEN_KEY` — the switch that turns the feature on

Encrypts stored OAuth tokens and signs the OAuth `state` parameter. Nothing
works without it.

From the repo root:

```bash
openssl rand -base64 32 | wrangler secret put WEARABLE_TOKEN_KEY
```

The value is never displayed — it goes straight from `openssl` into Cloudflare,
never touching a terminal, a log or shell history. That is deliberate: nobody
needs to know it, so nobody should.

**Cloudflare secrets are write-only** — it cannot be read back afterwards. If it
is ever lost, everyone who had connected a device reconnects. That costs nothing
today (zero connections), which is exactly why generating an unseeable value now
is the right trade. If you would rather keep a recoverable copy, **ask first**;
do not decide that alone.

## 2. `GARMIN_PUSH_SECRET` — needed to fill in Garmin's form

Authenticates Garmin's push callbacks. Garmin does not sign its pushes, so
knowledge of the URL is the only thing separating a real one from a forged one.

**Generate it as hex, not base64:**

```bash
openssl rand -hex 32
```

**Why hex matters here.** This value is read out of a URL query parameter.
Base64 contains `+`, and in a query string `+` legally means a space — so a
base64 secret would arrive with spaces where plusses were, never match, and
every Garmin push would fail with a 404 that looks exactly like Garmin being
broken. Hex has no such characters and cannot be misread. (The endpoint decodes
defensively too, but there is no reason to rely on that.)

Then:

1. **Save it to the password manager** under something like
   "Ikigaro — Garmin push secret". You will need it again on Garmin's form,
   possibly weeks from now, and Cloudflare will not give it back.
2. Set it on the Worker:

   ```bash
   wrangler secret put GARMIN_PUSH_SECRET
   ```

   (paste the value when prompted)

3. Keep it to hand for the Garmin application. The push URL registered there is:

   ```
   https://app.ikigaro.com/api/wearables/garmin-push?key=<the hex value>
   ```

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

Both `WEARABLE_TOKEN_KEY` and `GARMIN_PUSH_SECRET` should appear. Cloudflare
lists secret **names** only, never values — that is the correct check and the
only one available.

Then load `app.ikigaro.com`, sign in, and open Settings.

You should see a **"Connected devices"** section listing Apple Health and
Google Health Connect under "Coming soon", **with nothing connectable yet**.
That is the expected and correct result, not a half-broken state: the token key
switches the machinery on, and individual providers only appear once each one's
client id and secret are also set. None are yet.

## Do not

- Do not set either secret on `ikigaro-reminders`.
- Do not copy production values to staging.
- Do not commit them, put them in an `.env` file, or paste them into Supabase.
- Do not include either value, or any part of one, in your report back.

## Report back

- That both names appear in `wrangler secret list`
- That `GARMIN_PUSH_SECRET` is saved in the password manager and was generated
  as **hex**
- That Settings shows "Connected devices" with the two coming-soon rows and
  nothing connectable

No values, no partial values, no lengths.
