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

#### Both hosts are confirmed now

Their docs give both paths without repeating the host, so we guessed
`partner.ultrahuman.com` from the `/api/partners/` prefix and the personal-token
API.

**`/api/partners/oauth/token` on that host is proven**, by a real code exchange
on 2026-08-04: a live connection completed, stored tokens, and synced. Also
proven by the same round trip: the `/authorise` spelling, the three scope
strings, the redirect URI, and that their token response carries no user
identifier.

**On that last point: `profile` scope is requested and not yet used.** We never
call `/user_info`, so `external_user_id` is null on Ultrahuman connections, and
nothing reads it. That is expected rather than a fault, and there is a test
pinning it. The scope is held rather than dropped because changing a scope list
forces every live connection back through consent, and paying that twice, once
to remove it and once to add it back when `/user_info` is wired up, is worse
than carrying one unused scope. Wire it up when there is a reason to: an
identifier for vendor support conversations, or a webhook that needs to name a
user.

**`/api/partners/v1/user_data/metrics` is now proven too**, by the first
successful sync on 2026-08-04.

> **A set `last_sync_at` did NOT originally prove this, and it was claimed that
> it did.** `fetchRange` caught each day's request individually and continued,
> so a wrong host, a 404 and a ring that was never worn all returned the same
> empty array. `storeMetrics` stored nothing, and `syncConnection` then recorded
> a **success** and stamped `last_sync_at`. A completely broken integration
> would have reported itself healthy forever.
>
> That hole is closed: if **every** day in the window fails, the adapter throws
> instead of returning empty, so the failure reaches `last_error` and the
> failure counter. A `last_sync_at` stamp now means at least one request
> genuinely succeeded, which is what makes it evidence. A `ReauthRequired` is
> also rethrown immediately rather than counted as a missing day, since a
> revoked grant is not an empty one.

#### CGM: requested, and stored as daily summaries only

Glucose arrives on the **same** endpoint, gated by the `cgm_data` scope, from
an Ultrahuman M1. We request that scope: glucose is the one wearable signal
that moves against a blood panel on the axis the panel actually measures, which
makes it worth more to us than any recovery score. A user without a CGM simply
has no glucose entries, so the scope costs them nothing.

**Five daily summaries are stored**, not the trace:

| Their key | Ours | Note |
|---|---|---|
| `average_glucose` | `glucose_avg` | mg/dL |
| `glucose_variability` | `glucose_variability` | coefficient of variation, % |
| `time_in_target` | `glucose_time_in_target` | % of day in range |
| `hba1c` | **`hba1c_estimated`** | see below |
| `metabolic_score` | `metabolic_score` | 0-100, and not a quantity, see below |

The raw `glucose` entry is a reading every few minutes. That is a time series
and does not belong in a table whose grain is one row per day per metric, and
nothing we analyse needs it: what moves with a lab panel is the day's average,
spread and control, not the shape of one afternoon.

##### The estimated HbA1c is not the lab HbA1c

Stored under its own key on purpose. A lab HbA1c measures glycated haemoglobin
directly and integrates roughly three months; a CGM estimate is derived from a
few weeks of averages, and the two legitimately disagree. Our biomarker catalog
already holds a real, measured `hba1c` from blood panels.

Letting a device estimate share that key would let it silently stand in for a
clinical value, which is the single worst thing this integration could do. A
test asserts the adapter never emits the bare `hba1c` key.

Which of the two wins where they overlap, and the one pair where the device
beats the blood panel, is in
[`WEARABLE_DATA.md`](./WEARABLE_DATA.md#when-a-blood-panel-and-a-device-describe-the-same-thing).

##### `metabolic_score` is the odd one out

Every other key in our vocabulary is a quantity: steps are steps whoever counts
them. This is Ultrahuman's own composite on an arbitrary 0-100 scale, so a
second vendor's 72 would not mean their 72.

It is stored anyway, because it is the number a CGM user actually looks at each
day, and because a score that moves while the underlying average holds steady is
worth seeing. The constraint is what it must never do: it is single-source by
nature, never merged across providers, and never compared to a lab value. It is
recorded as `prefer: "neither"` against `hba1c` in
[`biomarker-overlap.ts`](../src/lib/wearables/biomarker-overlap.ts) precisely
because it sits next to glucose in the UI and invites that comparison.

### Whoop, audited 2026-08-04 before anyone connected

Checked against Whoop's published v2 documentation. **Four real bugs, one of
them silent and total**, all fixed before registration rather than after a
member had connected. Recorded because the same audit is still owed to Oura,
Fitbit and Withings.

| Was | Is | Consequence if left |
|---|---|---|
| `sleep.stage_summary` | `sleep.score.stage_summary` | **`sleep_minutes` was never emitted at all.** Nothing threw, nothing logged, the metric was simply absent |
| `/developer/v1` | `/developer/v2` | v1 webhooks are already removed and new features land on v2 first |
| asleep = in-bed minus awake | asleep = light + deep + REM | `total_no_data_time_milli` counted sensor gaps as sleep |
| naps included | naps skipped | The upsert is keyed on (user, provider, date, metric), so a 20 minute nap arriving after the night would **replace** it |

Three smaller ones from the same pass: records with `score_state` other than
`SCORED` are skipped, since `PENDING_SCORE` and `UNSCORABLE` both occur in
normal use; the recovery score is withheld while `user_calibrating` is true,
because Whoop themselves say it is not yet meaningful in a new member's first
weeks, though the raw heart-rate and HRV figures are kept; and a null element in
a records array no longer throws, which a test caught.

**`skin_temp_celsius` is deliberately not mapped.** Whoop reports an absolute
skin temperature, around 33, while our `temperature_deviation` is a difference
from the wearer's own baseline, around -0.2. They are different quantities and
charting one as the other is not a rounding error.

**Scopes are `read:sleep`, `read:recovery`, `read:cycles`, `offline`.**
`read:profile` was dropped: it returns the member's name and email and we call
no profile endpoint. `read:cycles` is kept although we do not call `/cycle`,
because Whoop's recovery documentation says recovery is reached "through the
Cycle endpoints in the V2 API", and a 403 there would cost a re-consent from
every connected member. `offline` is the load-bearing one: without it Whoop
issues no refresh token and every connection dies within the hour.

**Pagination is not followed.** 25 is the documented maximum for these
collections and a 7 day window is well inside it. Widen `syncWindowDays` and
`next_token` has to be handled first.

### Whoop: blocked on an active WHOOP membership, and capped at 10

**Not a code fault and not a config fault.** The app is correct: client id,
secret, redirect URI and scopes all verified. Recorded in full because the error
text points the wrong way and because the second finding changes what Whoop is
worth to us.

#### The error, and what it is not

```
error=request_unauthorized
error_description=The request could not be authorized
error_hint=Check that you provided valid credentials in the right format.
```

That reads as "your client id or scope string is malformed". **It is not.** A
malformed scope returns `invalid_scope`, a member declining returns
`access_denied`, and the same client id reached Whoop's sign-in page, which it
could not do if Whoop did not recognise it.

> **A wrong turn worth recording.** The first explanation reached for was that a
> development-mode app has a **Test Users whitelist** the member must be added
> to. That came from a third-party write-up, was acted on before being checked
> against Whoop's own documentation, and **is wrong**. There is no whitelist and
> no such interface in the dashboard: only a non-clickable
> "10 REMAINING TEST USERS" counter. This is the second time in this
> integration that a plausible first explanation was acted on before being
> verified. Check the vendor's own docs first.

#### What actually gates it

Whoop's overview opens with: *"You must have a WHOOP membership to develop an
app on the Developer Platform."* Their approval page adds: *"Apps can be used
for development immediately with a limit of 10 WHOOP members."*

So authorisation is open to **any WHOOP member**, up to ten of them. The counter
decrements as members connect; there is nothing to add anybody to. The founder's
account has no band and therefore no active membership, which is why the sign-in
bounces.

**Whoop cannot be exercised from an account without an active membership.** It
needs a person who owns a working WHOOP band, exactly as Ultrahuman needs
someone with a ring.

#### The cap is the strategic finding

**Ten members, total, until Whoop approves the app**, and approval is not a
formality. Whoop's public community forum carries multiple developers reporting
submissions from March onward with *"no approval, no rejection, no timeline"*,
including at least one platform describing almost exactly our use case, wearable
data alongside quarterly lab work.

What follows from that:

- **Ten is fine for closed beta** and costs nothing to start.
- **Ten is a wall**, and the process for lifting it currently resembles Garmin's:
  submit, then wait indefinitely. Do not build a plan that assumes it lifts.
- **Submit early anyway.** Approval requires having tested with at least one real
  member, so the first Whoop tester is also what unblocks joining the queue. The
  queue is long, so joining it sooner is free.
- Ultrahuman has no equivalent cap, which makes it the better bet for anything
  past the first ten Whoop users.

### Extra Oura and Whoop scopes: granted, dormant, and why they stay that way

Both portals now carry scopes we do not request: Whoop's `read:workout`, and
Oura's `Workout`, `Stress` and `Heart Health`. They were ticked deliberately,
and leaving them dormant is also deliberate.

**Granting at the portal only permits a scope. The code decides what the consent
screen asks for.** A scope we never put in the authorize URL is never consented
to and never returns data, which is why this costs nothing and breaks nothing.

Three things have to be true before any of them turns on.

**1. Workouts do not fit `wearable_daily_metrics`.** That table is one row per
day per metric. A workout is a session: a start, an end, an intensity, a sport,
and several can happen in one day. Forcing it in would mean either inventing a
daily aggregate nobody asked for, or hitting the same last-write-wins collision
that naps caused. It needs its own table and a migration.

Before that, it needs a decision that is not ours to make alone: **what is a
workout for, here?** Ikigaro reads blood panels and shows trends. "You trained
four times this week" is a fact; whether it belongs beside an ApoB reading, and
what it would change, is a product question. The answer probably exists, but
writing the table first and finding the use afterwards is how a schema acquires
a column nobody reads.

**2. Oura's Stress and Heart Health scope strings are unverified.** Oura's
published scope list has eight entries: `email`, `personal`, `daily`,
`heartrate`, `workout`, `tag`, `session`, `spo2`. Neither Stress nor Heart
Health appears. The portal's display names are not necessarily the OAuth
strings, and there is no public documentation mapping them.

**A wrong scope string does not fail quietly for that one scope. It fails the
whole authorize request**, which would take the working `daily`, `heartrate`
and `spo2` baseline down with it and present exactly as Whoop's
`request_unauthorized` does. Guessing here risks a working integration to add a
speculative one.

**3. The collections exist, which is the encouraging part.** Oura v2 does carry
`daily_stress`, `daily_cardiovascular_age` and `vO2_max`, alongside `workout`.
So the data is real and the mapping is tractable. Only the scope strings and
response shapes are missing, and both become readable the moment a member with
a ring connects, or via Oura's sandbox below.

#### Oura has a sandbox, and it is the cheapest way to settle all of this

`/v2/sandbox/usercollection/<collection>` mirrors the production endpoints and
returns **deterministic sample data without a connected ring**. That is worth
knowing: every adapter in this repo has been written against documentation and
four of four were wrong, and this is the one vendor that offers a way to check a
response shape without owning the hardware.

Not wired up. Worth an hour, and it would let the remaining Oura collections be
mapped against real payloads instead of prose.

### The sandbox check ran green on 2026-08-06, and what that does not mean

First time any adapter in this repo has been checked against a vendor's real
payload rather than their prose. **All nine collections returned data and every
field path we read was present**, including `workout`, `daily_stress`,
`daily_cardiovascular_age` and `vO2_max`.

So the Oura mapping is right, which after four adapters that were wrong is
worth saying plainly.

> **It does NOT settle the Stress and Heart Health scope question, and the
> first reading of the result said it did.** The sandbox accepts *any* string as
> a bearer token, which means it enforces **no scopes at all**. A sandbox with
> no scope enforcement cannot demonstrate scope enforcement. Those three
> collections answering proves they exist and that we read them correctly; it
> says nothing about whether a real member's grant will admit them.
>
> That question is settled only by a live connection, and until then the
> defensive fetch in the adapter is what makes it not matter: if the scope is
> absent the three metrics are missing and nothing else breaks.

What the run did settle, beyond the field paths: GitHub's runners can reach
`api.ouraring.com`, so this check runs unattended from now on.

### Two things the first live Oura connection taught us

**Oura namespaces its scopes internally.** We request `daily heartrate spo2`,
and the token response comes back granting `extapi:daily extapi:heartrate
extapi:spo2`. So the short names in the authorize URL are correct and Oura
expands them. Worth recording as the only hard evidence we have about their
scope vocabulary, and as a lead if the Stress and Heart Health strings ever
need chasing: whatever they are, they are probably `extapi:` something.

**A connection keeps the scopes it was granted, forever.** The live Oura
connection was made before `workout` was added to the request, so its stored
scopes are the older three, and it will never return workouts. That is not a
bug and there is nothing to fix in code: an OAuth grant cannot gain a permission
after the fact.

> **Adding a scope means every existing connection needs one reconnect.** Not
> urgent while nobody has a ring, but the rule to remember: change the scope
> list only when the benefit is worth asking every connected member to
> reconnect, or before anyone connects at all. Fitbit's expansion was timed for
> exactly that reason.

### Fitbit moved to the Google Health API, and the adapter has to be rewritten

**Found 2026-08-06, verified against Google's own pages the same day.** This
invalidates the plan in the section below, which is kept because its findings
about Fitbit's DATA are still true and the rewrite needs them.

`dev.fitbit.com`'s registration form now says registration of new applications
there is discontinued, and that the legacy Fitbit Web API is **deprecated in
September 2026**. Both halves matter and either alone would be fatal: we cannot
get legacy credentials, and legacy has about a month left.

Fitbit access now runs through the **Google Health API**, which is a different
API rather than a renamed one:

| | Legacy Fitbit Web API | Google Health API |
|---|---|---|
| Host | `api.fitbit.com` | `health.googleapis.com` |
| Sign-in | Fitbit account | **Google account** |
| Auth | Fitbit OAuth | Google OAuth 2.0 / Google Identity Services |
| Reads | 100+ endpoints | `dailyRollup`, `rollUp`, `list`, `patch`, `batchDelete` |
| Scopes | 7 short strings | 3 `googlehealth.*.readonly` URLs |
| Tokens | ours today | **do not carry over**, per Google |

Our seven scopes collapse into three: `activity` and `cardio_fitness` become
`activity_and_fitness.readonly`; `heartrate`, `oxygen_saturation`,
`respiratory_rate` and `temperature` all become
`health_metrics_and_measurements.readonly`; `sleep` becomes `sleep.readonly`.

**That last collapse is worth noticing.** Four metrics that were four separately
declinable scopes are now one bundle, so under Google Health they arrive or
refuse together. The defensive per-collection fetch stays useful, but the
failure mode it guards against changes shape.

**Two constraints to design around, not discover later.** An unverified Google
OAuth client is capped at **100 test users** and needs a third-party security
review to go past that, and while the client is unpublished **refresh tokens
expire after 7 days**. A tester connected before the client is published drops
after a week. Publish before anybody relies on it.

**The adapter is marked `unavailable` rather than deleted.** An unconfigured
provider is already hidden from the connect UI, so the risk was never that a
member sees it; the risk is the next reader seeing a complete audited adapter
and concluding Fitbit is one registration away. `providerConfigured()` now
returns false for any provider carrying an `unavailable` reason, credentials or
not, and a test pins that. What survives the rewrite is everything the adapter
learned about Fitbit's data, which is most of the value in the section below.

**Registration comes after the rewrite, not before.** The old order (register
first, then code) was right when the scope list was the free variable. Here the
Google Cloud client, its redirect URI and its three scopes all have to match
code that does not exist yet, and 7-day test-mode tokens make a premature
connection a moving target.

Sources: Google's [migration guide](https://developers.google.com/health/migration),
[API specifications](https://developers.google.com/health/migration/api-specifications),
[scopes](https://developers.google.com/health/scopes) and
[setup](https://developers.google.com/health/setup).

---

### Fitbit extended 2026-08-06, before registration and on purpose

> **Superseded in part.** Everything here about Fitbit's DATA still holds and
> the Google Health rewrite needs it. Everything about the legacy API surface,
> hosts, scope strings and registration, is dead. See the section above.

Fitbit was the one provider still unregistered, which made it the one whose
scope list was still free to change. So the endpoints were written first and the
application will be created against the finished list, rather than the usual
order of registering and then discovering what is missing.

**Three metrics became eight**: HRV, blood oxygen, breathing rate, skin
temperature deviation and VO2 max joined steps, resting heart rate and sleep.

**All four overnight collections describe the "main sleep"**, and Fitbit says
plainly that a value dated the 22nd may come from a night that began on the
21st. They have already decided which day it belongs to, so `dateTime` is used
as given rather than shifted, which is the opposite of the rule for Oura's sleep
document.

**`temp/skin` maps directly** where Whoop's did not. `nightlyRelative` is
already a deviation from the wearer's own baseline, signed and legitimately
negative, which is exactly what `temperature_deviation` means. Whoop's
`skin_temp_celsius` is an absolute reading near 33 and stays unmapped.

**HRV uses `dailyRmssd`, not `deepRmssd`.** The second covers deep sleep only
and is not what any other vendor reports.

#### Fitbit workouts, and the two traps in them

`GET /1/user/-/activities/list.json?afterDate=&sort=asc&offset=0&limit=100`.
The endpoint takes no end date, `offset` must be 0 and `limit` caps at 100, so
the far edge of the window is trimmed in the adapter. It also gives a duration
rather than an end time; `duration` (which includes pauses) is used rather than
`activeDuration`, so our interval agrees with the clock the way Oura's and
Whoop's spans do.

**Trap one: distance is not reliably metric.** Fitbit's data dictionary says
distance arrives in "units defined by the Accept-Language header", and their
own published example shows `"distanceUnit": "Mile"`. Reading it as kilometres
understates an American member's run by 38% and nothing fails. So the unit is
read from the payload and an unrecognised one yields no distance at all. A
blank field is a gap; a wrong one is a lie in a health record.

**Trap two: Fitbit invents workouts.** SmartTrack logs a "Walk" after roughly
fifteen minutes of sustained movement, unasked. Left alone, a member who walks
to the station twice a day would open the Training card and see seven training
days out of seven, having trained on none of them: the headline number,
inflated by us.

The first fix dropped short auto-detected sessions at the adapter. **That was
half right and it threw away real data.** A walk is movement, and movement is
most of what this app is about: everyday and load-bearing activity acts on
bone, muscle, gut and metabolic health whether or not anybody would call it a
workout. Deleting it meant the only signal we had for it never reached the
database.

So every session is stored and the distinction travels with it, in
`wearable_workouts.auto_detected` (migration 0021).

**Intent is the line, not duration.** Started by the member is training,
because they meant it to be. Noticed by the device is movement. No per-sport
thresholds to argue about, one sentence to explain to a user, and the judgment
call sits where it belongs: somebody who considers their auto-detected hour a
real session can log it at check-in, and `trainingLoad()` already reconciles
the two sources per day, so their own view wins.

`fitstar`, Fitbit's guided-workout app, counts as member-started. Only
`auto_detected` does not.

**False is right for every other provider.** Oura, Whoop and Ultrahuman never
say how a session came to exist, so the column stays false for them: that is
"they do not say", not "we know they did not", and it preserves exactly the
behaviour those rows already had.

A retired provider still gets a row in Settings when somebody is connected to
it, with Disconnect and no Connect. `unavailable` removes a provider from the
connect list, and on its own that would strand anyone already connected: no
row, no Disconnect, no way to revoke a grant we can no longer sync. **Retiring
an integration must never take away the exit.**

The Training card shows movement on its own line, in its own words, never
summed into the training numbers. Rest days are still counted against training
only: a day spent walking is not a training day, and calling it one would undo
the whole point of keeping them apart.

#### The trap: VO2 max is a string, and sometimes a range

Their own documented example returns both forms:

```json
{"cardioScore":[{"value":{"vo2Max":"44-48"}},{"value":{"vo2Max":"45"}}]}
```

Fitbit gives a single number only when the user runs with GPS; otherwise it is a
band. **`Number("44-48")` is NaN**, so passing this through the usual numeric
helper drops every ranged reading silently, and the metric looks like it simply
never arrives for anyone who does not run.

`fitbitVo2Max()` takes the midpoint of a band, which is the honest reading and
keeps the series continuous when a user moves between the two forms.

#### Every collection is optional

Each of the five sits behind its own scope, and a member can untick any of them
at the consent screen. A refusal returns 403, which `providerFetch` turns into
`ReauthRequired` and the sweep treats as a dead grant. So each is fetched
defensively: declining blood oxygen costs blood oxygen, not the connection.

### Oura and Fitbit, audited 2026-08-04

Same pass as Whoop, same result. **Four of four adapters audited so far were
wrong**, and in each case the failure mode was a metric that silently never
appeared rather than anything that broke.

**Oura: blood oxygen was never arriving.** Two causes at once. `spo2` is one of
Oura's eight scopes and was not requested; and `spo2_percentage` was being read
off the `/sleep` document, where no such field exists. It lives on the separate
`daily_spo2` collection, which we now call. `personal` was dropped from the
scope list: it returns gender, age, height and weight, and we call no personal
endpoint.

`heartrate` is kept although we never call `/heartrate` directly. Oura's docs
are not explicit about whether the HRV and resting-heart-rate fields on the
sleep document sit behind it, and losing those silently is much worse than
carrying a scope we may not need. Same judgement as Whoop's `read:cycles`, and
worth revisiting once somebody is connected and it can be tested rather than
guessed.

**Fitbit: naps were overwriting whole nights.** Fitbit logs a nap as its own
sleep record with the same `dateOfSleep` as the night. Because the metrics
upsert is keyed on (user, provider, date, metric), whichever arrived last won,
so a 40 minute afternoon nap could replace a 7 hour night. `isMainSleep` is now
required. This is the identical trap Whoop's `nap` flag sets, found in two
vendors independently.

**Fitbit no longer publishes a sleep score.** `efficiency` was standing in for
one. It is time asleep over time in bed, which is a different quantity: Fitbit's
actual Sleep Score is a composite and is not on the public API at all. Under our
own key it would have sat in the same series as Oura's score meaning something
else, unreconcilable against Fitbit's own app, where it is not even called the
same thing. Contributing nothing is the honest answer. Fitbit gives us steps,
resting heart rate and sleep duration.

Three Fitbit scopes were dropped as dead: `profile`, `weight` and
`oxygen_saturation`. Adding SpO2 later means putting that last one back, which
is free before anyone connects and costs a re-consent afterwards.

**Withings is the only adapter never audited.** Treat it as unverified.

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

**Base64url, missing padding and embedded whitespace are all accepted**, and
fold to the same bytes as the standard spelling, so re-spelling the secret
cannot orphan tokens already stored under the other form.

### The 2026-08-03 incident, and the wrong turn in the middle of it

Worth reading in full, because the wrong turn is the instructive part.

**Symptom.** Connecting Ultrahuman redirected to `?wearable=failed`. The log
said:

```
wearable callback failed for ultrahuman: InvalidCharacterError: atob() called
with invalid base64-encoded data.
```

That reads like the vendor rejected us, and it sent the first round of
investigation to Ultrahuman's token endpoint. **Nothing was ever wrong with
Ultrahuman.** The token exchange had already succeeded; the throw came from
`encryptToken`, one step later, decoding `WEARABLE_TOKEN_KEY`.

**The wrong turn.** The key was decoded with a bare `atob`, which on Workers
rejects `-`, `_` and unpadded input, so the obvious hypothesis was that the key
was merely *spelled* base64url. The decoder was made tolerant, which was the
right change for a real defect (two decoders in one directory,
`oauth-state.ts`'s tolerant one and this strict one, with the strict one holding
the encryption key), **but it was not the cure, and the hypothesis was never
tested before being acted on.** It could not be tested, because the shell-row
bug below meant no connect was attempted again until two rounds later.

**The actual cause.** The key is not base64 at all. The tolerant decoder rejects
it too. Encryption with that key had therefore never once worked, which is why
nothing was ever stored and why rotating it cost nothing.

**Three fixes came out of it, and all three were worth having:**

1. **The tolerant decoder.** Correct on its own merits, and it is what
   `oauth-state.ts` always did.
2. **`wearableKeyProblem()` at `/api/wearables/connect`.** A bad key now returns
   503 **before** the user is sent to a vendor, rather than after they have read
   a consent screen and tapped Approve for nothing. This is the guard that
   finally surfaced the real cause, in one line, at the front door.
3. **The message says which failure it is:** an out-of-alphabet character (not
   base64 at all, no decoder will ever read it) versus a bad length (base64 but
   truncated). Those need different actions, and conflating them is exactly what
   produced the wrong turn. Neither branch names a character or a length, so
   nothing about the key leaks into the logs.

**The lesson worth keeping:** the first plausible explanation for an
`InvalidCharacterError` was a spelling difference, and it was wrong. A guard
that reports *which* precondition failed would have said so immediately.

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

### Disconnect now tells the vendor, for the two who document how

Pressing Disconnect always deletes our row, which destroys our copy of the
credentials. What used to survive that was the authorisation sitting in the
member's vendor account, which is why reconnecting goes straight to consent
with no sign-in.

`revokeAtVendor()` in `sync.ts` now asks the vendor to tear the grant down,
BEFORE the row is deleted, since the credentials go with it.

| Provider | Revoke | Endpoint |
|---|---|---|
| Fitbit | yes | `POST /oauth2/revoke`, Basic auth, `token=<refresh token>` |
| Whoop | yes | `DELETE /developer/v2/user/access`, member's bearer token |
| Oura | not yet | Their auth doc has a "Revoking The Access Token" section, and every extractor we have strips the code block holding the literal URL. Queued for Cowork to read off the page. |
| Ultrahuman, Withings, Garmin | no | No revoke endpoint found in their documentation. |

**Two rules, and both are the point of the feature.**

**It never blocks the disconnect, and that is enforced rather than intended.**
Somebody who pressed the button has to end up disconnected even when a vendor
is down. A failed revoke that aborted the delete would leave them connected to
an app they just left, with live tokens on our side, which is the worse of the
two failures by a distance.

The first version of this said exactly that in a comment and did not do it:
the revoke was awaited with no bound, so a vendor that accepted the connection
and then went quiet would hold up a request the member is watching a spinner
on, and a Worker timing out mid-revoke would never reach the delete at all.
Press Disconnect, see a failure, stay connected: the precise outcome the
feature exists to prevent. It is now capped at three seconds, by an
`AbortSignal` every implementation must pass to its fetch AND a race around
the call, so an implementation that forgets the signal still cannot hang the
request. A test pins that the signal reaches `fetch`.

Three seconds because nothing downstream depends on the answer. We are telling
the vendor something, not asking.

**No endpoint is called unless it is confirmed from that vendor's own docs.**
A guessed revoke URL 404s quietly and leaves us believing we revoked something
we did not. That is not a missing feature, it is a privacy claim we cannot
support, and `wearables.test.ts` asserts the exact list of providers that
implement `revoke` so nobody adds a plausible-looking URL later.

**The access token IS refreshed first when it has expired, and the reasoning
that said otherwise was wrong.** The first version used the stored token as-is,
on the grounds that refreshing in order to revoke mints a credential purely to
destroy it. That reads well and it broke Whoop: their revoke authenticates with
the member's access token, and those last about an hour. Disconnect any time
after the nightly sync and the stored token is already dead, so Whoop answers
401, the outcome is logged as "failed", and the grant survives at their end.
The feature would have worked for one of the two providers that support it, and
only during the hour after a sync. Fitbit was unaffected either way, because its
revoke takes the refresh token.

The rotated token is deliberately NOT persisted: the row is about to be
deleted, and writing it back would only widen the window in which a
half-finished disconnect leaves live credentials behind. On a genuinely dead
grant the refresh throws, which lands as "failed", and the row is deleted
regardless.

---

## Deliberately not done yet

- **Nothing is surfaced in Future You.** Trends now shows merged device series
  and a Training and recovery card; the habit model still reads only check-ins.
  What device data should *say* there is a product question worth answering
  with real data in hand rather than guessing at now.
- **Wearable data earns no points.** Steps are trivially spoofable and paying
  for them invites exactly that. If this changes, pay for *connecting* once, not
  for the numbers.
- **No backfill beyond the sync window.** Most vendors offer months of history
  on first connect. Worth adding once we know which metrics matter.
