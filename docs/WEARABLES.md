# Wearable integrations, setup and operation

Six cloud wearable providers, connected by OAuth from the existing web app. No
native app, no app store, no review.

> **The code is complete and shipping does nothing on its own.** Every provider
> needs credentials you have to go and get. A provider whose env vars are unset
> is hidden from the UI, so deploying this is safe and invisible until you
> configure at least one.

---

## Do these two things today

Garmin and Ultrahuman are **not self-serve**, both need an application
reviewed, and the published lead times run one to four weeks. Everything else
takes an afternoon. Start these now so the wait runs in parallel with the rest:

| Provider | Where | What they ask for |
|---|---|---|
| **Garmin** | Garmin Developer Program → Health API | Company details, use case, expected user volume, privacy policy URL |
| **Ultrahuman** | Developer portal at `vision.ultrahuman.com/developer-docs` (log in to create an OAuth app) | Use case, user base, how the data will be used |

Both will want `https://app.ikigaro.com/privacy` and a clear sentence about what
we do with the data. "Show users their own sleep and recovery alongside their
lab panels; never sold, never used for advertising" is accurate and is the
answer they are looking for.

---


### Ultrahuman: two APIs, and which one we ship

**Verified against the authenticated docs on 2026-08-03.** Everything here is
read from Ultrahuman's own documentation, not inferred.

There are **two separate APIs**, with different hosts, different Authorization
header formats and different query parameters. An adapter written against one
will not work against the other.

| | **OAuth API** (what we ship) | **Personal token API** |
|---|---|---|
| Metrics path | `/api/partners/v1/user_data/metrics` | `partner.ultrahuman.com/api/v1/partner/daily_metrics` |
| Auth header | `Authorization: Bearer <token>` | `Authorization: <token>`, **bare, no Bearer** |
| Date params | `date` only, one day per request | `date`, or `start_epoch`/`end_epoch` (≤ 7 days) |
| Obtained by | authorize, then token exchange | a button in the portal |

We ship the OAuth API: it is the only one that works for anybody other than the
account holder. The personal-token API is useful for validating against real
data before credentials exist, but it needs a ring and a portal login.

**OAuth app creation is self-serve.** An in-portal modal, no review and no
queue, which makes Ultrahuman an afternoon rather than a multi-week wait. The
form takes a **single** redirect URI, so get it right first time:
`https://app.ikigaro.com/api/wearables/callback/ultrahuman`.

#### Facts that cost something if you get them wrong

- **The refresh token rotates.** Documented explicitly: *"next time you refresh
  the tokens make sure to use the newly granted refresh token"*. Our
  `persistTokens` writes it back unconditionally, which is why this is safe.
- **Sleep is in SECONDS** (`"unit": "seconds"`), so `total_sleep: 25500` is 7h05m.
- **`active_calories` does not exist.** No calories field appears anywhere in
  their payload. `active_minutes` is minutes and is not a substitute.
- **The response is not flat.** `data.metrics` is a **map keyed by date**, each
  holding an **array of `{type, object}`** entries, and the value lives under a
  different key per entry: `value` for scalars, `avg` for averaged series,
  `total` for steps.
- **Two HRVs and two resting heart rates.** `avg_sleep_hrv` versus `hrv`, and
  `sleep_rhr` versus `night_rhr`. We take the overnight one in both cases,
  because that is what a recovery figure means.
- **Two sleep scores.** A top-level `sleep_score` entry and a nested
  `sleep.object.score`, which are different numbers. We use the top-level one.
- **`temperature_deviation` is signed** and legitimately negative. Distinct
  from `temp` and `average_body_temperature`, which are absolute.

#### Two things their docs contradict themselves on

1. **Token lifetime.** The prose says tokens "are valid for a week", the field
   block says `86400 seconds (1 day)`, and the response says
   `"expires_in": 86399`. We trust `expires_in` from the response and refresh
   early, which is what `accessTokenFor` already does. Nothing is hard-coded.
2. **The authorize path spelling.** Their spec text says `/authorize`; every
   worked example uses `/authorise` on `auth.ultrahuman.com`. We follow the
   examples. If consent ever 404s, try the other spelling before assuming
   anything else is wrong.

#### One thing still unverified

The **host** for the OAuth token and metrics paths. The docs give the paths
(`/api/partners/oauth/token`, `/api/partners/v1/user_data/metrics`) without
repeating the host. We use `partner.ultrahuman.com`, matching both the
`/api/partners/` prefix and the host the personal-token API uses. Confirm it
with the first real token exchange.

#### CGM

Glucose arrives on the **same** endpoint, gated by the `cgm_data` scope:
`glucose`, `average_glucose`, `glucose_variability`, `hba1c`, `time_in_target`,
`metabolic_score`, all in mg/dL. **We do not request that scope**, because we
store none of it, and asking a user for data we will not use is how a consent
screen stops being read. If glucose ever becomes a feature, the scope is the
only change needed on their side.

## The self-serve four

Register a developer app with each, then set the two env vars.

| Provider | Portal | Redirect URI to register |
|---|---|---|
| Oura | cloud.ouraring.com → OAuth applications | `https://app.ikigaro.com/api/wearables/callback/oura` |
| Fitbit | dev.fitbit.com → Register an app | `https://app.ikigaro.com/api/wearables/callback/fitbit` |
| Whoop | developer.whoop.com | `https://app.ikigaro.com/api/wearables/callback/whoop` |
| Withings | developer.withings.com | `https://app.ikigaro.com/api/wearables/callback/withings` |

**The redirect URI must match byte for byte**, scheme, host, path, no trailing
slash. Every one of these vendors rejects a mismatch with the same unhelpful
`invalid redirect_uri` and nothing else. The value is generated in one place,
`src/lib/wearables/urls.ts`, so what you register is what we send.

For staging, register a second app per vendor against the staging host and set
`APP_ORIGIN` there.

---

## Secrets to set

All are Worker secrets (`wrangler secret put NAME`), never committed, never
pasted into chat.

```
WEARABLE_TOKEN_KEY        # required, see below
OURA_CLIENT_ID / OURA_CLIENT_SECRET
FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET
WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET
WITHINGS_CLIENT_ID / WITHINGS_CLIENT_SECRET
GARMIN_CLIENT_ID / GARMIN_CLIENT_SECRET
GARMIN_PUSH_SECRET        # required before Garmin works, see below
ULTRAHUMAN_CLIENT_ID / ULTRAHUMAN_CLIENT_SECRET
```

### `WEARABLE_TOKEN_KEY`

```bash
openssl rand -base64 32
```

Exactly 32 bytes, base64. It encrypts the stored OAuth tokens and signs the
OAuth `state` parameter.

**Without it the feature is off**, and that is deliberate: `encryptToken` throws
rather than writing a plaintext token into a column named `_enc`. A
half-configured deployment storing real credentials in the clear is worse than
one that cannot store them at all, because nothing about it looks wrong
afterwards.

**Losing or rotating it** costs every connected user a reconnect. Recoverable,
and far better than the alternative, so rotate only if you believe it leaked.

---

## Why the tokens are encrypted when the health data is not

A refresh token is not a reading, it is **standing permission**: it lets whoever
holds it pull a user's sleep, heart rate and recovery from a third party,
indefinitely, until somebody notices and revokes it.

Postgres encrypts at rest at the disk level, which defends against someone
stealing a disk, not the realistic threat here, which is a leaked service-role
key or a stray `pg_dump`. A key that lives only in Worker secrets means the
database on its own is not enough to impersonate our users against six vendors.

---

## How it runs

| Piece | Where |
|---|---|
| Nightly sweep | `GET /api/cron/sync-wearables` (CRON_SECRET bearer) |
| Manual "Sync now" | `POST /api/wearables` `{action:"sync"}` |
| Garmin push | `POST /api/wearables/garmin-push` |
| Connect / disconnect | Settings → Connected devices |

The sweep re-pulls a **fixed recent window** (7 days, 14 for Withings) rather
than tracking a high-water mark. Every one of these vendors revises data after
the fact, a sleep score finalises hours later, a watch that was offline
backfills days at once, so a window plus an idempotent upsert is both simpler
and more accurate than a cursor that would silently miss every late arrival.

It is bounded per run and ordered by `last_sync_at` ascending, so it cannot
outgrow the Worker's CPU budget and nobody can be starved.

### Garmin is different

Garmin's Health API **has no on-demand fetch at all**. It pushes to a registered
webhook when a watch syncs, and there is no endpoint to ask "what happened last
Tuesday". Consequences:

- The sync sweep skips it. That is correct, not a failure, and does not count
  against the connection.
- A user who connects Garmin sees nothing until their watch next syncs. The UI
  says so, because otherwise it reads as broken.
- Register the push URL in the Garmin developer console, **including the
  secret**:

  ```
  https://app.ikigaro.com/api/wearables/garmin-push?key=<GARMIN_PUSH_SECRET>
  ```

  Garmin does not sign its pushes, so knowledge of that URL is the only thing
  separating a real push from a forged one. Without the check, anyone who
  learned a Garmin user id could inject arbitrary sleep, steps and HRV into that
  person's account, data they would then be shown as their own.

  The endpoint **fails closed**: with `GARMIN_PUSH_SECRET` unset every push is
  rejected, because there is nothing to check against and accepting everything
  is worse than accepting nothing. It answers 404 rather than 401, so an
  unauthenticated caller cannot confirm the endpoint exists.

  **Generate it URL-safe**, `openssl rand -hex 32` is the easiest way, and any
  plain alphanumeric value does just as well. What matters is avoiding `+` and
  `/`: the value is read out of a query parameter, where `+` legally means a
  space, so a base64 secret would arrive with spaces where plusses were and
  never match, failing as a 404 that looks like Garmin being broken rather
  than a config error. The route decodes defensively so base64 does in fact
  work, but there is no reason to depend on that.

---

## Adding a seventh provider

1. Add the id to `ProviderId` and to the `provider` CHECK in a new migration.
2. Add an adapter to `src/lib/wearables/providers.ts`. OAuth endpoints, scopes,
   and a `fetchRange` that returns `DailyMetric[]`.
3. Nothing else. Refresh, rotation, backoff, persistence and upsert are shared.

Normalize into the existing vocabulary in `metrics.ts` wherever the vendor is
answering a question we already have a key for. Whoop's "recovery" and Oura's
"readiness" both land on `readiness_score` for exactly that reason, two keys
would put the same idea on two axes and make the charts lie by omission.

**Rescale scores in the adapter, never at read time.** Everything ending
`_score` is 0-100 by the time it leaves the adapter.

Once a metric can come from more than one provider, how the winner is chosen is
in [`WEARABLE_DATA.md`](./WEARABLE_DATA.md), read that before adding a provider
that overlaps an existing one.

---

## The trap that will bite whoever touches this next

**Refresh tokens rotate.** Most of these vendors return a *new* refresh token on
every refresh and retire the old one. If the new one is not persisted, the
connection keeps working until the access token expires and then dies
permanently, hours later, with nothing in the logs connecting the failure to
the cause.

`sync.ts` therefore writes back whatever it receives, unconditionally, and
persists **before** using the token: if the data call then fails, the rotated
refresh is already banked. The other order throws away a valid credential every
time a vendor has a bad minute.

---

## Deliberately not done yet

- **Nothing is surfaced in Trends or Future You.** The data lands and stores;
  what it should *say* is a product question worth answering with real data in
  hand rather than guessing at now.
- **Wearable data earns no points.** Steps are trivially spoofable and paying
  for them invites exactly that. If this changes, pay for *connecting* once, not
  for the numbers.
- **No backfill beyond the sync window.** Most vendors offer months of history
  on first connect. Worth adding once we know which metrics matter.
