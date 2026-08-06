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

## 1. The two that were meant to need approval, and no longer do

Neither of these is a queue to wait in any more, for opposite reasons.

**Ultrahuman** turned out to be self-serve: creating the OAuth app is an
in-portal modal with no review. Done on 2026-08-03.

**Garmin** has paused new API access reviews indefinitely, with no timeline. So
there is nothing to wait for there either, just a recheck every quarter.

**Every provider we can ship is therefore self-serve.** The only thing between
us and working wearable data is registering the remaining four and owning a
device.

> **Audit the adapter before you register.** Every one of these was written
> from assumption in a single sitting, before any vendor documentation was in
> hand. Ultrahuman's turned out wrong in almost every particular, and Whoop's
> was silently dropping sleep entirely. Both were found by reading the vendor's
> published docs against the code, which takes an hour and is far cheaper than
> finding out after a member has connected. Oura, Fitbit and Withings have not
> had this treatment yet.

### ☑ Garmin. Health API + Activity API. SUBMITTED 2 August 2026

**Status: PAUSED AT GARMIN'S END, indefinitely.** Do not resubmit, and do not
wait on this.

Garmin replied on 2026-08-03:

> "we have temporarily paused the review and approval of new API access
> requests and are unable to provide a specific timeline for when new
> application processing will resume"

**So Garmin is out of the plan for now.** The adapter, the push endpoint and the
audit in [`GARMIN_AUDIT.md`](./GARMIN_AUDIT.md) all stay as they are: nothing is
wasted, and none of it is blocking anything else. When the queue reopens, the
integration is already written.

**Recheck roughly every three months.** Nothing else to do in between: there is
no queue position to hold and no form to resubmit. Reply to the existing thread
with `connect-support@developer.garmin.com` rather than starting a new request,
so the original submission date is preserved if they honour it.

Everything below is what to register **if and when** access is granted.

The Garmin Connect Developer Program "Access Request Form" page renders no
form, only a header and a "stay tuned" line, so it is not the route in. We
submitted through the **wellness partner form** at
`garmin.com/en-IN/forms/wellnesspartner/` and followed up by email to
`connect-support@developer.garmin.com`.

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

`GARMIN_PUSH_SECRET` is **already generated and set**, and saved in the password
manager, which is where to get it for their form. Cloudflare cannot show it to
you again.

It is deliberately URL-safe (hex), because it travels in a query string where a
`+` legally means a space. A base64 secret would arrive with spaces where the
plusses were, never match, and make every push look like Garmin being broken
rather than a config bug.

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

**☑ App created 2026-08-03**, named `ikigaro`, with all three scopes: **Ring
Data**, **CGM Data** and **Profile**.

CGM is requested deliberately. Glucose is the one wearable signal that moves
against a blood panel on the axis the panel actually measures, which makes it
worth more to us than any recovery score. A user without an M1 simply has no
glucose entries. What we store from it, and why the CGM-estimated HbA1c is kept
well away from the lab one, is in [`WEARABLES.md`](./WEARABLES.md).

**Remaining:** set `ULTRAHUMAN_CLIENT_ID` and `ULTRAHUMAN_CLIENT_SECRET` as
Worker secrets, from the portal's OAuth Applications page. Ultrahuman then
appears in Settings on its own. Nothing else to switch on.

The adapter was rewritten against the authenticated docs on 2026-08-03. The
facts worth knowing before touching it, including the two places Ultrahuman's
own documentation contradicts itself, are in
[`WEARABLES.md`](./WEARABLES.md).

---

## 2. The self-serve four, an afternoon each

### ☑ Oura. REGISTERED 2026-08-04, on the NEW portal

**The portal moved and this checklist used to send you to the wrong one.**
As of 15 October 2025, new applications must be created at
**`developer.ouraring.com`**. The legacy `cloud.ouraring.com/oauth/applications`
page still exists and can still edit applications created there, but it will not
create new ones. Ikigaro's application lives in the new portal, so **future
edits happen there**.

The new portal also requires a **Terms of Service** URL, which the old one did
not: `https://app.ikigaro.com/terms`.

**Registered:**

| Field | Value |
|---|---|
| Display name | `Ikigaro` |
| Website | `https://app.ikigaro.com` |
| Redirect URI | `https://app.ikigaro.com/api/wearables/callback/oura` |
| Privacy policy | `https://app.ikigaro.com/privacy` |
| Terms of service | `https://app.ikigaro.com/terms` |

**Scopes granted at the portal:** `Daily`, `Heartrate`, `SpO2`, `Workout`,
`Stress`, `Heart Health`. Left off: `Email`, `Personal`, `Tag`, `Session`,
`Ring Configuration`.

> **The new portal ships every scope pre-ticked.** Untick deliberately rather
> than accepting the default, or the consent screen asks for everything.

#### Granted at the portal is not the same as requested by the code

**The code requests three:** `daily`, `heartrate`, `spo2`. Those three are what
the consent screen will show and what we can actually read.

`Workout`, `Stress` and `Heart Health` are **granted but dormant**: permitted at
the portal, never asked for at authorize time, so no member ever consents to
them and no data arrives. That is harmless, and it is not a bug. Turning any of
them on is a code change, and each has a real blocker:

- **Workout does not fit our storage.** `wearable_daily_metrics` is one row per
  day per metric; a workout is a session with a start, an end and an intensity,
  and several can happen in a day. It needs its own table, a migration, and
  first a decision about what a workout is *for* next to a blood panel. Same
  applies to Whoop's `read:workout`.
- **Stress and Heart Health scope strings are unverified.** Oura's published
  scope list has eight entries and contains neither. The portal's display names
  are not necessarily the OAuth strings, and **a wrong scope string breaks the
  entire authorize request**, not just that scope. That would take the working
  `daily`/`heartrate`/`spo2` baseline down with it.

**Ten user limit**, their documented default: *"By default, API Applications
have a ten user limit."* Review is submitted from the application's own page,
once a real member has connected.

**Remaining:** set `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET` as Worker Secrets
and redeploy. Oura then appears in Settings on its own.

### ☐ Fitbit. READY TO REGISTER, and the scope list changed

Audited 2026-08-04, then **extended 2026-08-06 before registration**, which was
deliberate: Fitbit is the one provider not yet registered, so changing its scope
list is free today and costs a re-consent from every connected member
afterwards. The endpoints were written first so the boxes get ticked once.

**It now contributes eight metrics rather than three:** steps, resting heart
rate, sleep duration, **HRV, blood oxygen, breathing rate, skin temperature
deviation and VO2 max**.

- **Where:** `dev.fitbit.com` → Manage → Register an app
- **Redirect URI:** `https://app.ikigaro.com/api/wearables/callback/fitbit`
- **OAuth 2.0 Application Type:** `Server` (not Client or Personal. Personal
  only ever reads your own account, which is not what we are building)
- **Default Access Type:** `Read Only`

**Scopes to tick, exactly these seven:**

| Scope | What it buys |
|---|---|
| `activity` | Steps |
| `heartrate` | Resting heart rate **and HRV** |
| `sleep` | Sleep duration |
| `oxygen_saturation` | Blood oxygen |
| `cardio_fitness` | VO2 max |
| `respiratory_rate` | Breathing rate |
| `temperature` | Skin temperature deviation |

**Do NOT tick `weight` or `profile`.** Nothing reads either, and `profile`
returns personal details we never use.

Every scope above is read by the adapter, and there is a test asserting the list
matches. If you tick more, the consent screen asks for access we do not use; if
you tick fewer, the member simply loses those metrics, since each collection is
fetched defensively and a refusal does not fail the sync.

**Fitbit contributes no sleep score**, deliberately: their real Sleep Score is
not on the public API and the `efficiency` figure that was standing in for it is
a different quantity. See [`WEARABLES.md`](./WEARABLES.md).

**Workouts are not synced from Fitbit yet**, unlike Oura and Whoop. Their
activity log is a different shape from both, its `offset` parameter accepts only
`0`, and the session field names were not verifiable from their published
reference the way the daily collections were. Deliberately left rather than
guessed at.

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
