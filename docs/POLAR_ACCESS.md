# Polar AccessLink: what is confirmed, and what the adapter still needs

Written 2026-08-18, at the start of the Polar integration.

**Read this before writing a line of adapter.** The record in `WEARABLES.md`
described the v3 API and was built partly on a third-party write-up. Some of
what it said is now confirmed from Polar's own sources, and some of it turns out
to describe an API that is no longer the current one.

---

## The headline: there are two Polar APIs, and they are different products

| | **AccessLink v3** ("Open AccessLink") | **AccessLink Dynamic API v4** |
|---|---|---|
| Getting data | **Transaction model.** `POST` to open a transaction, list items, `GET` each, `PUT` to commit. Uncommitted data is re-served; committed data is gone | **Range queries.** `from` and `to` on the endpoint, like every other vendor here |
| Scopes | None in Polar's own example's authorize URL | **Ten**, e.g. `activity:read`, `sleep:read`, `nightly_recharge:read` |
| Access token | Polar's own example stores one and never refreshes it | **Valid 12 hours**, refresh token required |
| Sleep | Not in the v3 swagger models at all; Polar's example calls an undocumented-looking `/users/sleep/` | First-class, with **stages** |
| History | "You can only query new data and don't have access to historical data" (Polar's own launch blog) | Range queries up to 90 days for activity, 28 for Nightly Recharge |

**v4 is what a new integration should target.** Every fact in the v4 column
below comes from Polar's own published v4 reference.

### This corrects something we had written down as fact

`WEARABLES.md` recorded, from a third-party write-up, that Polar tokens are
long-lived. A widely-syndicated blog states it outright: "Polar access tokens
are long-lived and do not expire. This simplifies token management
significantly." **For v4 that is false.** Polar's own words: "The access token
is valid for 12 hours. A refresh token must be used to get a new access token."

That is the difference between an integration that works and one that works for
half a day and then silently stops, which is this codebase's single most
expensive class of bug. It is also a good argument for the rule that produced
this document: third-party summaries are a lead, never a source.

---

## Confirmed from Polar's own sources

### From their v4 reference (`polar.com/polar-api-v4`)

**Token exchange uses HTTP Basic**, not form fields. Their words: "Basic auth
with base64 encoded string `client_id:client_secret`". So `tokenAuth: "basic"`,
the same as WHOOP and Withings, and not the default.

**Token response**: `access_token`, `token_type: "bearer"`, `refresh_token`,
`expires_in` (their example: 43199, so twelve hours less a second), `scope`,
`jti`.

**POST data**: `grant_type` (`authorization_code`), `code`, `refresh_token` for
the refresh flow, and `redirect_uri` "must be specified if redirect_uri was
passed to authorization endpoint".

**The ten scopes**:

| Scope | Grants |
|---|---|
| `activity:read` | Daily activity |
| `sleep:read` | Sleep |
| `nightly_recharge:read` | Nightly Recharge |
| `continuous_samples:read` | Continuous samples (24/7 heart rate) |
| `ppi_data:read` | Pulse-to-pulse intervals |
| `calendar:read` | Calendar entries |
| `devices:read` | Registered devices |
| `profile:read` | Profile, **including email** |
| `routes:read` | Routes |
| `skin_contact:read` | Skin contact |

Ask for four: `activity:read`, `sleep:read`, `nightly_recharge:read` and
`continuous_samples:read`. **Not `profile:read`**, which carries the member's
email and buys us nothing we do not already have, and not the sample-level
scopes, which are traces rather than daily summaries.

**Endpoints seen**, on host `www.polaraccesslink.com`:

- `GET /activity/list`, parameters `from`, `to`, `features`
- `GET /nightly-recharge-results`, parameters `from`, `to`, `features`
- `GET /sleeps` and `GET /sleep-wake-vectors`
- `GET /ppi-samples`, `GET /skin-contacts`, continuous samples, calendar,
  routes, favorites, sports and sport profiles, profile pictures

**THE `features` TRAP, and it is a bad one.** Their words for
`/activity/list`: "When no features are in use, date range can be 90 days. If
features are used, only one day at a time can be requested. **Without features
the response contains only the dates where activity data is available.**"

So the obvious call, a 90-day range with no `features`, returns *a list of
dates and no data*. An adapter written against the obvious call stores nothing
and looks exactly like a member with no activity. Getting actual numbers means
one request per day, which changes the shape of a backfill completely: 90 days
is 90 requests, not one. `/nightly-recharge-results` behaves the same way with a
28-day ceiling.

**Sleep carries real stages**, which is the reason Polar is worth doing:
`sleepDate`, `sleepResult`, `originalSleepResult` ("only available if the sleep
has been edited"), `sleepScore`, `sleepEvaluation`, and `phaseDurations` with
`wake`, `rem`, `light`, `deep`, `unknown`, plus `remPercentage` and
`deepPercentage`.

**Durations are Protobuf duration strings, not numbers.** Their example:
`{"wake": "60s", "rem": "70s", "light": "80s", "deep": "90s"}`, and the
description allows "seconds with optional fraction of seconds in maximum of
nanoseconds precision like `3.000000001s`". A parser doing `Number(x)` on `"80s"`
gets `NaN`. This is a v4-wide convention, not a sleep quirk.

### From Polar's own example application (`polarofficial/accesslink-example-python`)

This is Polar's code, not a community project, which makes it a primary source
for the v3 flow. It confirms:

- Authorization: `https://flow.polar.com/oauth2/authorization`
- Token: `https://polarremote.com/v2/oauth2/token`
- API base: `https://www.polaraccesslink.com/v3`
- **Basic auth on the token exchange**, matching the v4 reference
- **`POST /users` registers the member and is mandatory.** Their own docstring:
  "Once partner has been authorized by user, partner must register user before
  being able to access her data." The body is `{"member-id": "<our own id>"}`.
  A fork of Polar's client documents the follow-on detail: **409 Conflict means
  already registered and can be ignored.**
- **`DELETE /users/{user_id}` de-registers and revokes the token.** That is a
  revoke endpoint confirmed from the vendor, which is the bar `WEARABLES.md`
  sets before implementing `revoke`.

The registration step was previously recorded here from a third-party write-up
with a note to verify it. **It is verified**, at least for v3.

---

## What is still missing, and why the adapter is not written yet

Polar's egress is blocked from the build environment: `www.polar.com` and
`www.polaraccesslink.com` both return 403 at the proxy. The v4 reference can be
read only through a search tool that returns the page in reranked fragments, so
the facts above are the ones that survived that filter intact.

**The gaps are exactly the fields `fetchRange` has to map:**

1. **`sleepSleepResult` properties.** Stages are confirmed; total sleep time,
   the start and end of the night, and whether `sleepScore` is 0-100 are not.
   `sleep_minutes` and `sleep_score` cannot be filled without them.
2. **`nightlyrechargeNightlyRechargeResult` properties.** The sample containers
   are visible (`NightlyRechargeHrvSamples`, `NightlyRechargeBreathingRateSamples`)
   but not the nightly averages, which are what maps to `hrv`,
   `resting_heart_rate` and `respiratory_rate`.
3. **The daily activity summary fields.** Step *samples* are visible;
   whether a day carries a step total and a calorie total, and under what names,
   is not.
4. **The `features` enum.** The trap above is confirmed; the actual values to
   send are not, and without them every range call returns dates only.
5. **Rate limits.** The reference has a "Rate limiting" section that did not
   survive extraction.
6. **Whether v4 still requires `POST /users`.** Confirmed for v3, unknown for
   v4, and it is the difference between a working connection and one that
   authorises perfectly and then 403s on every read.

**Guessing any of these is how the Ultrahuman adapter happened**: written from
assumption rather than documentation, wrong in almost every particular, and
silent about it. That adapter is the reason this file exists.

### What unblocks it

Polar publish **`swagger.yaml`** on the v4 reference page, under
"Development resources", described there as "The Swagger specification can be
used to generate client implementations". That single file answers all six
questions above and removes every guess.

It is one download from any browser outside this proxy. That is the same route
the COROS reference guide took, and it turned a guessed adapter into a checked
one.

---

## When the spec is in hand

1. Register the application at Polar's developer portal. Self-serve, no approval
   period. `POLAR_CLIENT_ID` / `POLAR_CLIENT_SECRET` as Cloudflare secrets,
   never in a file.
2. Confirm from the spec whether v4 needs the `POST /users` registration step.
   If it does, it belongs in the OAuth callback, not the sync path: a
   connection that skips it is authorised and unreadable.
3. Decide the backfill shape against the `features` trap. One request per day is
   the honest reading; check the rate limits before committing to a 90-day
   backfill that costs 90 calls per member.
4. Parse durations as Protobuf duration strings (`"80s"`), not numbers, and put
   that in a helper with a test, because it appears across the whole API.
5. Map onto the existing vocabulary: stages sum to `sleep_minutes` the way
   WHOOP's do, Nightly Recharge's nightly averages to `hrv` and
   `resting_heart_rate`, activity to `steps`, and physical info's VO2 max to
   `vo2_max`. Rescale any score to 0-100 in the adapter, never at read time.
6. `DELETE /users/{user_id}` as `revoke`, since it is confirmed from Polar's own
   client.
