# Wearable provider applications, the checklist

Everything to register, in the order to do it. Values below are pulled from
`src/lib/wearables/providers.ts` and `urls.ts`, they are what the code actually
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

**"Web application" is correct, and stays correct after the native apps ship.**
The field describes where the OAuth *client* runs, not where the user is. Ours
is a confidential server-side client: the secret lives on the Cloudflare Worker
(`clientCreds()` in `src/lib/wearables/sync.ts`), the redirect lands on our
domain, and the token exchange is server to server.

The iOS and Android apps will do what the web app does today: open a browser to
our `/api/wearables/connect`, the user consents at the vendor, the vendor
redirects to our callback, our Worker exchanges the code. The phone never talks
to a vendor directly and never holds a secret. From the vendor's side the
traffic is identical either way, so **no form needs resubmitting**: same client
id, same secret, same redirect URI.

The native apps exist for Apple HealthKit and Android Health Connect, which are
on-device APIs with no OAuth and no vendor registration at all. They add a data
source without touching any of the six applications below.

> **Do not register the native app as its own OAuth client.** That would be a
> separate public client with PKCE and a custom-scheme redirect
> (`ikigaro://callback`), which several vendors treat as a whole new
> application. A native client cannot keep a secret, it would triple the
> credentials to manage, and refresh-token rotation would have to be solved
> on-device instead of once on the server.

If a form asks which platforms the app is *available* on, as a marketing or
review question rather than an OAuth client type, answer
**"Web today; iOS and Android planned"**.

**What does require going back to a vendor:** changing the redirect URI host,
requesting additional scopes, or a post-beta production-access review (Garmin
and Fitbit both do this, and it is about volume, not platform).

**Description** (fits most "what does your app do" boxes):

> Ikigaro is a longevity and performance app. Users upload their blood panels
> and check in daily; we show them their own trends over time. Connecting a
> wearable lets a user see their sleep, recovery and activity alongside those
> lab results, so habits and biomarkers can be read together.

**Data use** (asked by Garmin, Ultrahuman, and Fitbit's review):

> Data is shown only to the user it belongs to. It is never sold, never shared
> with third parties, and never used for advertising or ad targeting. Users can
> disconnect at any time, which deletes the stored authorisation.

That is an accurate description of what the code does, the connection row is
deleted outright on disconnect, and nothing about wearable data touches the
rewards or partner logic.

---

## 1. Garmin first, because only Garmin makes you wait

Garmin is the one approval queue here, one to four weeks, so file it before
anything else and let the clock run while you do the rest.

**Ultrahuman is no longer in this category.** It was believed to need approval;
it does not. Creating the OAuth app is self-serve and takes an afternoon. It is
kept in this section only because the submitted-form history below is worth
recording.

### ☑ Garmin. Health API + Activity API. SUBMITTED 2 August 2026

**Status:** submitted, awaiting response. Do not resubmit.

The Garmin Connect Developer Program "Access Request Form" page renders no
form, only a header and a "stay tuned" line, so it is not the route in. We
submitted through the **wellness partner form** at
`garmin.com/en-IN/forms/wellnesspartner/` and followed up by email to
`connect-support@developer.garmin.com`.

Garmin's published turnaround is confirmation within two business days, then a
typical integration of one to four weeks. If no confirmation has arrived after
two business days, chase the email address above rather than resubmitting the
form.

**Registered when access arrives:**

- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/garmin`
- **Push URL:** `https://app.ikigaro.com/api/wearables/garmin-push?key=<GARMIN_PUSH_SECRET>`
  (substitute the real value from the password manager; never write it here)

- **Where:** Garmin Developer Portal → Health API → request access
- **Extra fields they ask for:** company/entity name, expected user volume
  (say: *early beta, under 100 users, growing through 2026*), and which data
  types you need
- **Data types to request:** Dailies (steps, resting heart rate, calories),
  Sleep, HRV
- **Scope:** `HEALTH_EXPORT`

The push secret is already generated first so you have it to hand, **URL-safe**, because it
travels in a query string where `+` legally means a space. Hex is the easiest
way; any plain alphanumeric value is equally fine:

```bash
openssl rand -hex 32
```

Save it to your password manager. Cloudflare secrets cannot be read back, and
you need this value again on Garmin's form.

> Garmin is push-only, there is no way to poll it. Data arrives when a user's
> watch next syncs, which is why the push URL matters as much as the OAuth one.

### ☑ Ultrahuman: form submitted 2 August 2026, but it is the WRONG FORM

**Status:** we submitted "Become a partner" at `ultrahuman.com/us/partners/`.

⚠️ **That form is the enterprise sales funnel**, aimed at research institutions,
healthcare providers, sports teams, gyms and companies deploying rings at
scale. It is not the route to API credentials, and a reply from it is unlikely
to be about the API. No harm done, but do not wait on it.

**The actual route is the developer portal** at
`vision.ultrahuman.com`, and as of 2026-08-03 this is **confirmed self-serve**:
creating an OAuth application is an in-portal modal with no review, no queue
and no wait-time wording anywhere. Ultrahuman is an afternoon, not a multi-week
approval, so it does not belong in the "start these first" section at all.

**Create the app with:**

- **App name:** `Ikigaro`
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/ultrahuman`
  (the form takes **one**, so it has to be right first time)
- **Scopes:** tick **Ring Data Access** and **Profile Access**. Leave **CGM
  Data Access** unticked: glucose arrives on the same endpoint when granted, we
  store none of it, and asking for data we will not use is how a consent screen
  stops being read.

Then set `ULTRAHUMAN_CLIENT_ID` and `ULTRAHUMAN_CLIENT_SECRET` as Worker
secrets and it appears in Settings on its own.

The adapter was rewritten against the authenticated docs on 2026-08-03. The
facts worth knowing before touching it, including the two places Ultrahuman's
own documentation contradicts itself, are in
[`WEARABLES.md`](./WEARABLES.md).

---

## 2. The self-serve four, an afternoon each

### ☐ Oura

- **Where:** `cloud.ouraring.com` → your account → OAuth applications → New
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/oura`
- **Scopes:** `daily`, `heartrate`, `personal`
- Gives you a client id and secret immediately.

### ☐ Fitbit

- **Where:** `dev.fitbit.com` → Manage → Register an app
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/fitbit`
- **OAuth 2.0 Application Type:** `Server` (not Client or Personal. Personal
  only ever reads your own account, which is not what we are building)
- **Scopes:** `activity`, `heartrate`, `sleep`, `oxygen_saturation`, `weight`,
  `profile`
- **Default Access Type:** `Read Only`

### ☐ Whoop

- **Where:** `developer.whoop.com` → create an app
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/whoop`
- **Scopes:** `read:recovery`, `read:sleep`, `read:cycles`, `read:profile`,
  `offline`
- `offline` is the one that matters, without it Whoop issues no refresh token
  and every connection dies within the hour.

### ☐ Withings

- **Where:** `developer.withings.com` → create an application
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/withings`
- **Scopes:** `user.metrics`, `user.activity`

---

## 3. Secrets

**Already done, do not redo:** `WEARABLE_TOKEN_KEY` and `GARMIN_PUSH_SECRET`
were both set on the production Worker `ai-tools` on 2026-07-30. The push secret
is in the password manager, which is where to get it for Garmin's form above.
Cloudflare cannot show it to you again.

**Still to do, two per provider, as each one's credentials arrive:**

```bash
wrangler secret put OURA_CLIENT_ID
wrangler secret put OURA_CLIENT_SECRET
# …and the same pair for FITBIT_, WHOOP_, WITHINGS_, GARMIN_, ULTRAHUMAN_
```

Each provider appears in **Settings → Connected devices** on its own once both
of its env vars are set and the Worker redeploys. Nothing else to switch on.

---

## Devices we evaluated and cannot add

Recorded so the same research is not repeated. A "no" here is about the
vendor's API, not the device, several are good hardware.

### ✗ Fittr HART, no route in, evaluated 2026-07-30

Three ways a device's data can reach us, and HART closes all three:

1. **No public or partner API.** No developer portal, no OAuth, no documented
   endpoint. Fittr's own site still ships placeholder copy in production, which
   suggests a partner API is not close.
2. **No Apple Health write.** This is the decisive one. Their privacy policy
   says the app *reads* from HealthKit and states plainly: *"Our App cannot
   write data to HealthKit."* So shipping our iOS app does **not** get us HART
   data, the ring's readings never enter HealthKit for us to read.
3. **No documented Health Connect write**, so the Android path is no better.

The data is a one-way silo: HART pulls context in, nothing comes out.

**If demand shows up**, the only move is a direct partnership approach to Fittr
for API access. That is a conversation worth having with a number attached, which is what the Requests tab in the admin console is for. Check it before
writing to them.

### Where the requests come from

Users suggest devices under **Settings → Connected devices → "Don't see your
device?"**. The ranked tally lands in **Admin → Requests**. Counts are distinct
people, so ten entries mean ten people, and each shows how many asked for an
email when the device goes live.

Use it to order the applications below. The current order is our guess about
what people own; the tally is what they actually own.

---

## The one mistake that will cost you an afternoon

**The redirect URI must match byte for byte.** Scheme, host, path, no trailing
slash, no `www`. Every one of these vendors rejects a mismatch with the same
message, `invalid redirect_uri`, and nothing else to go on.

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
the wiring end to end. The first one to land is the interesting one, connecting
your own account is what tells us whether this data is worth building Trends
around.
