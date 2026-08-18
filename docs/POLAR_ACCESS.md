# Polar AccessLink: the research, and the adapter built from it

Written 2026-08-18, over the course of the Polar integration. The first half is
the research that preceded the spec; the second half is what the spec turned out
to say and what the adapter does about it.

**Read this before touching the Polar adapter.** The record in `WEARABLES.md`
described the v3 API and was built partly on a third-party write-up. Some of
what it said is now confirmed from Polar's own sources, some turns out to
describe an API that is no longer the current one, and one claim was simply
false.

**Status: registered, credentials live, adapter shipped, never run against a
real account.** See "What the first real connection has to prove".

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

The swagger turns up more than the reference page's table lists, notably
`training_sessions:read` for workouts and `tests:read` for VO2 max.

We ask for five: `activity:read`, `sleep:read`, `nightly_recharge:read`,
`continuous_samples:read` and `training_sessions:read`. **Not `profile:read`**,
which carries the member's email and buys us nothing we do not already have, and
not the sample-level scopes, which are traces rather than daily summaries.

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
- **`DELETE /users/{user_id}` de-registers and revokes the token.**

The registration step was previously recorded here from a third-party write-up
with a note to verify it. **It is verified for v3.** It does not apply to v4:
there is no `/users` path anywhere in the v4 spec, so the workaround everyone
writes about would post to a URL that does not exist. The same goes for the
revoke endpoint, which is why the adapter ships without one; see "Still open".

---

## The adapter, built 2026-08-18 from `swagger.yaml`

The spec closed every gap this document previously listed. What follows is what
the adapter does and, more importantly, the four places where the spec says
something surprising.

### The token URL in circulation is the wrong one

The swagger's `securityDefinitions` is the only place that states v4's OAuth
hosts, and it names **`https://auth.polar.com/oauth/token`**. Polar's own v3
example application, every community client derived from it, and the integration
brief we were working from all say `https://polarremote.com/v2/oauth2/token`.
That is the v3 endpoint. Both authorize and token live on `auth.polar.com` for
v4, and a token exchange sent to the wrong host fails at the one moment a member
is watching a spinner.

The data host is `https://www.polaraccesslink.com/v4/data`, from the swagger's
own `servers` entry rather than assembled from parts.

### `features` decides whether you get data at all

Confirmed across `/sleeps`, `/activity/list`, `/nightly-recharge-results`,
`/training-sessions/list`, `/tests/list` and `/ppi-samples`: **without
`features` the response contains only the dates where data is available**, and
**with `features` only one day can be requested**. The feature vocabularies:

| Endpoint | Features | Range without features |
|---|---|---|
| `/sleeps` | `sleep-result`, `original-sleep-result`, `sleep-evaluation`, `sleep-score` | 30 days |
| `/activity/list` | `samples`, `activity-target`, `physical-information` | 90 days |
| `/nightly-recharge-results` | `samples` | 28 days |
| `/training-sessions/list` | `samples`, `test-results`, `training-load-report`, `laps`, `hill-splits`, `routes`, `statistics`, `zones`, `pause-times`, `strength-training-results`, `comments`, `physical-info` | 90 days |

`collectionFormat: multi`, so the key repeats: `?features=a&features=b`, never a
comma list. And `to` is **exclusive** on every endpoint, so one day means
tomorrow's date.

**This is why there is no backfill window.** Ninety days of history exists and
reaching it costs 90 requests per data type per member. Four data types makes
one member's first sync 360 calls against an app-wide budget of 3,000 per
fifteen minutes, so eight people connecting in an afternoon would exhaust it.
The seven-day sweep fills history in a week instead, for free.

### There is no daily step total

Nowhere in v4. `/activity/list` returns step **samples**, bucketed by interval,
**per device**, and the total is ours to compute. `polarSteps()` does it and
takes **the highest single device rather than the sum of all of them**: a member
with a watch and a second Polar device has two things that counted the same
walk, and adding them reports a bigger day than happened, which is the direction
nobody questions. Their own note that a device "might not be kept on for a full
day, so there can be gaps" means the maximum can undercount a day split across
two devices. Undercounting a real day is the smaller lie, and it matches what
Polar Flow shows the member.

### Durations are strings

`"80s"`, or `"3.000000001s"` at full precision, across the whole API.
`Number("80s")` is `NaN`, and a `NaN` reaching `push` is dropped silently, so
getting this wrong presents as sleep that never appears rather than as an error.
`polarSeconds()` parses it.

### What is mapped

| Our key | From | Note |
|---|---|---|
| `sleep_minutes` | `sleepEvaluation.asleepDuration` | **Not `sleepSpan`.** Our screen defines this to the member as time actually asleep; `sleepSpan` is time in bed. Polar report both, so unlike COROS we can take the one we mean |
| `sleep_score` | `sleepScore.sleepScore` | Documented 1-100, so already our scale |
| `hrv` | `meanNightlyRecoveryRmssd` | RMSSD in ms, exactly what Oura and WHOOP report. A rename, not a conversion |
| `respiratory_rate` | `60000 / meanNightlyRecoveryRespirationInterval` | See the gate below |
| `steps` | summed step samples | See above |
| workouts | `/training-sessions/list` | Distance, kcal, avg and max HR, and `autoDetected` from `startTrigger` |

**The respiratory rate carries a sanity gate.** Their spec's own example value
for that field is `800`, which converts to 75 breaths a minute: a placeholder
copied across several fields rather than a reading. If the unit is not what the
spec says, the arithmetic yields a confident wrong number rather than an obvious
failure, so anything outside 4-40 breaths a minute is **dropped, not clamped**. A
clamp would hide the mistake by squashing it to the nearest plausible value and
we would publish it as measured; a gap is visible and prompts someone to look.

### What is deliberately not mapped

**Resting heart rate.** They give `meanNightlyRecoveryRri`, a mean beat-to-beat
interval over a four-hour window, and converting it to bpm is arithmetic. But
our own screen defines resting heart rate to the member as "your lowest
sustained heart rate while asleep", and a four-hour mean is a different
quantity. A member wearing a Polar and an Oura would watch the number step by
several bpm whenever the merge changed source, with no way to tell a rule from a
bug.

**Readiness.** `recoveryIndicator` is 1-6 and `recoveryIndicatorSubLevel` places
you inside that class, so a continuous value is recoverable. What is not is the
top of the scale: whether class 6 runs to a notional 7 or terminates decides
whether to divide by five or six, and Polar do not say. That is a formula we
would invent and then show people as a score.

**Workout activity names.** Their `sport` field is a reference carrying an id and
no name. Resolving it needs the `sports:read` scope and a `/sports/list` fetch,
which is worth doing and is not worth guessing: a wrong sport label reads to the
member as what their watch recorded.

**Physical information.** Weight, height and VO2 max are all reachable through
the `physical-information` feature, and we do not ask for it. The vendor-side
registration deliberately switched that data type off, and `profile:read` is not
in our scope list.

Both of the first two want one real account to settle them.

### Polar count requests up, not down

Their headers are `RateLimit-Limit`, **`RateLimit-Usage`** and `RateLimit-Reset`:
requests **spent**, where every other vendor here reports requests **left**, and
without the `x-` prefix. `parseRateLimit` now reads both conventions and
converts usage into remaining, but only when a limit is present, because "spent
40" means nothing without "out of what".

Reading one as the other is the exact inverse: a nearly exhausted budget would
read as almost untouched, so we would sprint into a wall of 429s; a fresh budget
would read as nearly gone, so every request would take a pacing delay it does not
need. Both look like the vendor misbehaving rather than like us misreading a
header.

Documented limits: **3,000 requests per 15 minutes and 100,000 per 24 hours, per
client id.** No test-user cap and no security-review threshold.

---

## What the first real connection has to prove

Nothing here has run against a live Polar account, so the first connect is the
test rather than a formality. In order of how likely each is to be the thing
that breaks:

1. **The token exchange reaches `auth.polar.com`.** If the swagger is stale and
   `polarremote.com` is still the live v4 token host, the connect fails visibly
   at the callback. That is the first thing to read in the logs.
2. **The authorize screen lists five permissions and no email.** If Polar reject
   or silently drop a scope, the granted set comes back in the token response's
   `scope` field and is stored.
3. **A sync writes rows.** The specific risk is `features`: if the parameter
   name or a feature value is wrong, the calls return 200 with dates and no
   data, and store nothing while looking healthy. A connection with
   `last_sync_at` set and zero metrics is that failure.
4. **The step total is plausible.** Compare one day against Polar Flow. A number
   roughly double the app's means `polarSteps` should not have taken a maximum;
   a number well below means the maximum is losing a day split across devices.
5. **The respiratory rate appears at all.** If it is systematically missing, the
   unit is not milliseconds and the gate is doing its job.

## Still open

**No `revoke`.** v3 had `DELETE /users/{user_id}`, which de-registered the member
and invalidated the token. v4 has no equivalent path anywhere in the spec, and
this repo's rule is that a revoke endpoint is implemented only where the vendor's
own documentation confirms it: a guessed URL 404s quietly and leaves us believing
we revoked something we did not. So disconnecting deletes our credentials and
leaves the grant standing at Polar, which is why reconnecting goes straight to
consent. Worth asking their B2B helpdesk (`b2bhelpdesk@polar.com`) directly.

**Sport names**, which need `sports:read` and a catalogue fetch.

**Resting heart rate and readiness**, both above, both needing one real night of
data to judge.
