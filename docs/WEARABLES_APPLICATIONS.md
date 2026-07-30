# Wearable provider applications — the checklist

Everything to register, in the order to do it. Values below are pulled from
`src/lib/wearables/providers.ts` and `urls.ts` — they are what the code actually
sends, so paste them rather than retyping.

> **Never paste a client secret into chat, a commit, or a file.** They go
> straight into `wrangler secret put NAME` and nowhere else.

---

## Answers you will reuse on every form

| Field | Value |
|---|---|
| Application name | `Ikigaro` |
| Website | `https://app.ikigaro.com` |
| Privacy policy | `https://app.ikigaro.com/privacy` |
| Terms | `https://app.ikigaro.com/terms` |
| Support email | your founder email |
| Category | Health & fitness / Wellness |
| Platform | Web application |
| OAuth grant type | Authorization code |

**Description** (fits most "what does your app do" boxes):

> Ikigaro is a longevity and performance app. Users upload their blood panels
> and check in daily; we show them their own trends over time. Connecting a
> wearable lets a user see their sleep, recovery and activity alongside those
> lab results, so habits and biomarkers can be read together.

**Data use** (asked by Garmin, Ultrahuman, and Fitbit's review):

> Data is shown only to the user it belongs to. It is never sold, never shared
> with third parties, and never used for advertising or ad targeting. Users can
> disconnect at any time, which deletes the stored authorisation.

That is an accurate description of what the code does — the connection row is
deleted outright on disconnect, and nothing about wearable data touches the
rewards or partner logic.

---

## 1. Start these two FIRST — they take 1–4 weeks

Do these before anything else so the review clock runs while you do the rest.

### ☐ Garmin — Health API

- **Where:** Garmin Developer Portal → Health API → request access
- **Extra fields they ask for:** company/entity name, expected user volume
  (say: *early beta, under 100 users, growing through 2026*), and which data
  types you need
- **Data types to request:** Dailies (steps, resting heart rate, calories),
  Sleep, HRV
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/garmin`
- **Scope:** `HEALTH_EXPORT`
- **Also register the push URL** (they will ask, or ask later):
  `https://app.ikigaro.com/api/wearables/garmin-push?key=<GARMIN_PUSH_SECRET>`

Generate that secret first so you have it to hand:

```bash
openssl rand -base64 32
```

> Garmin is push-only — there is no way to poll it. Data arrives when a user's
> watch next syncs, which is why the push URL matters as much as the OAuth one.

### ☐ Ultrahuman — UltraSignal / Partner API

- **Where:** Ultrahuman developer docs → apply, or the partnership channel
- **Extra fields:** use case, user base size, how the data will be used
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/ultrahuman`
- **Scopes:** `read:metrics`, `read:sleep`

---

## 2. The self-serve four — an afternoon each

### ☐ Oura

- **Where:** `cloud.ouraring.com` → your account → OAuth applications → New
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/oura`
- **Scopes:** `daily`, `heartrate`, `personal`
- Gives you a client id and secret immediately.

### ☐ Fitbit

- **Where:** `dev.fitbit.com` → Manage → Register an app
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/fitbit`
- **OAuth 2.0 Application Type:** `Server` (not Client or Personal — Personal
  only ever reads your own account, which is not what we are building)
- **Scopes:** `activity`, `heartrate`, `sleep`, `oxygen_saturation`, `weight`,
  `profile`
- **Default Access Type:** `Read Only`

### ☐ Whoop

- **Where:** `developer.whoop.com` → create an app
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/whoop`
- **Scopes:** `read:recovery`, `read:sleep`, `read:cycles`, `read:profile`,
  `offline`
- `offline` is the one that matters — without it Whoop issues no refresh token
  and every connection dies within the hour.

### ☐ Withings

- **Where:** `developer.withings.com` → create an application
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/withings`
- **Scopes:** `user.metrics`, `user.activity`

---

## 3. Secrets to set once you have credentials

```bash
# The one that switches the whole feature on. Do this first.
openssl rand -base64 32 | wrangler secret put WEARABLE_TOKEN_KEY

# Then per provider, as each one comes through:
wrangler secret put OURA_CLIENT_ID
wrangler secret put OURA_CLIENT_SECRET
# …and the same pair for FITBIT_, WHOOP_, WITHINGS_, GARMIN_, ULTRAHUMAN_

# Garmin only, and only when its approval lands:
wrangler secret put GARMIN_PUSH_SECRET
```

Each provider appears in **Settings → Connected devices** on its own once both
of its env vars are set and the Worker redeploys. Nothing else to switch on.

---

## The one mistake that will cost you an afternoon

**The redirect URI must match byte for byte.** Scheme, host, path, no trailing
slash, no `www`. Every one of these vendors rejects a mismatch with the same
message — `invalid redirect_uri` — and nothing else to go on.

Copy the values from the tables above rather than typing them. They come from
`callbackUrl()` in `src/lib/wearables/urls.ts`, which is the same function that
builds the URL we send at runtime.

---

## Staging

Only worth doing if you want to test a provider without touching production.
Register a **second** app per vendor with the staging host in the redirect URI,
and set `APP_ORIGIN` on the staging Worker. Most people skip this and test on
production with their own account, which is fine at this size.

---

## What to send back

Nothing secret. Just tell me which providers came through and I will confirm
the wiring end to end. The first one to land is the interesting one — connecting
your own account is what tells us whether this data is worth building Trends
around.
