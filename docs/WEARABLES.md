# Wearable integrations, setup and operation

Six cloud wearable providers, connected by OAuth from the existing web app. No
native app, no app store, no review.

> **The code is complete and shipping does nothing on its own.** Every provider
> needs credentials you have to go and get. A provider whose env vars are unset
> is hidden from the UI, so deploying this is safe and invisible until you
> configure at least one.

---

## Migration 0022 has to run on production before that code merges

`wearable_source_preferences`, which lets a member choose which device answers
for each metric family. Migration-first, as always.

The code is written to survive the wrong order (`loadSourcePreferences` catches
its own read failure and returns the default ranking), so the app degrades to
today's behaviour rather than breaking. That is a safety net, not a plan.

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

**Pagination is followed, for Whoop only.** 25 is the documented maximum for
these collections. The request parameter is `nextToken` and the response field
is `next_token`, spelled differently on purpose; sending the wrong one is
ignored silently, so the walk in `whoopPages` stops if a token repeats and caps
at 12 pages either way. Every other adapter still reads the first page only,
which is correct for their 7 day window and is why none of them declares a
`backfillWindowDays`: asking for 60 days without following the token would keep
25 records and look complete.

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
submissions with *"no approval, no rejection, no timeline"*, several of them
tagging Whoop staff directly to ask for escalation. Threads seen on
`community.whoop.com` include *"Whoop Developer API, App Approval"* and *"API
Approval No Response for Over a Month"*; in the second, a developer names their
service as **YoLongevity.com** and says more than 100 of their users are waiting
on the integration. One developer has abandoned the official route entirely and
now has each user create their own Whoop developer app and connect with personal
API keys, which needs no approval at all.

**A note on this paragraph.** An earlier version said "at least one platform
describing almost exactly our use case, wearable data alongside quarterly lab
work" and named nobody, which made the claim impossible to check later and
impossible to answer when somebody asked which platform. The names above are
what the forum actually shows. Whether any of them pairs wearables with lab
panels the way we do is NOT established, so that comparison has been dropped
rather than left standing unsourced. **Record the name when the finding is
made**: a fact without its source becomes folklore in about a week.

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

### Ultrahuman has no workouts, checked 2026-08-07 before writing the adapter

**The plan was to add `fetchWorkouts` to Ultrahuman**, on the reasoning that it
is the only connected, working, uncapped provider and therefore the cheapest
way to give the workout pipeline a live producer. Checked first. It does not
exist.

**Ultrahuman's own list of Partnership API data** is: sleep, movement data,
steps, heart rate, HRV, temperature, VO2 max, Recovery Index, Movement Index,
Metabolic Score, plus the CGM set and profile. No sessions, no activities, no
exercise. Their Partner API is one date-based `/metrics` document per day, and
a session has nowhere to live in it.

An integration platform that has shipped this connector states it flatly in
their support matrix: *"Workouts / Activities: No (not available via
Partnership API)."* Their write-up adds the reason: the Ring AIR has no GPS and
is not primarily a workout tracker, so what the Ultrahuman app shows is
heart-rate-based session tracking that the API does not expose.

**So: no adapter work, and the entry stays absent rather than becoming an empty
`fetchWorkouts`.** A method that always returns `[]` looks like an integration
that is failing rather than one that was never possible.

#### The pipeline has a producer now: Oura, reconnected 2026-08-07

The reconnect landed and was verified in the database. The new grant carries
`extapi:daily extapi:heartrate extapi:spo2 extapi:workout`, where the old one
had only the first three. One row, replaced cleanly by the upsert rather than
duplicated.

**Oura prefixes granted scopes with `extapi:`** where we request them bare.
Worth knowing before somebody compares the two lists and concludes they
disagree.

The consent screen listed four permissions, which was the tripwire: three would
have meant production was running older code than main. It showed four, so it
is not.

**This is the first time any provider has been able to return a workout.**
Everything below described the state before that, and is kept because the
reasoning still holds for the other five providers.

#### What this means for the workout pipeline

Everything built for workouts, migrations 0020 and 0021, the device half of the
Training card, and the movement split, currently has **no live producer at
all**:

| Provider | Connected | Has `fetchWorkouts` | Can produce a workout today |
|---|---|---|---|
| Ultrahuman | yes | **no, and cannot** | no |
| Oura | yes | yes, sandbox-verified | **no, the grant predates the scope** |
| Whoop | no | yes | no |
| Fitbit | no | yes | no, adapter retired |
| Withings, Garmin | no | no | no |

**The cheapest live producer is now Oura, and it needs no code.** The adapter
requests `workout` and the contract check has confirmed every field path it
reads against Oura's sandbox. The only blocker is that the live connection was
granted before the scope was added, and an OAuth grant cannot gain a permission
after the fact. One disconnect and reconnect fixes it.

This is also the second time the same shape of finding has changed a plan in
two days: check what the vendor actually exposes before writing the adapter,
not after. Four of four adapters written from assumption were wrong; two of two
plans checked first were saved.

---

### The Google Health rewrite, done 2026-08-07 from the discovery document

**Written from `health.googleapis.com/$discovery/rest?version=v4` (revision
20260805), not from the migration guide.** That choice is the whole story of
this rewrite. Google publish a machine-readable spec, and it disagrees with
their own prose in four places, each of which would have produced a silently
absent metric, which is the exact failure that caught four adapters here:

| Google's prose | The spec | Cost of believing the prose |
|---|---|---|
| `dailyRollup` | **`dailyRollUp`**, capital U | 404 on every steps and calories call |
| Sleep and exercise among the rollup types | Both are **session** types read via `list` | Two metrics that never arrive |
| One name per data type | Path is **kebab-case**, filter field is **snake_case**, in the same request | Empty result, no error |
| Sessions filter on civil start time | **Sleep is excluded** and wants `sleep.interval.end_time` in RFC-3339 | Sleep never returns |

Fetching the discovery document takes one `curl`. Reading it took twenty
minutes and it caught all four before a line was written.

#### What the adapter now reads

Six `daily-*` collections through `list`, which the migration guide never
mentions and which are better than what the legacy API offered: one value per
day, already computed, instead of rolling up intraday samples.

| Metric | Data type | Field |
|---|---|---|
| `resting_heart_rate` | `daily-resting-heart-rate` | `beatsPerMinute` (int64, arrives as a STRING) |
| `hrv` | `daily-heart-rate-variability` | `averageHeartRateVariabilityMilliseconds` (RMSSD) |
| `spo2` | `daily-oxygen-saturation` | `averagePercentage` |
| `respiratory_rate` | `daily-respiratory-rate` | `breathsPerMinute` |
| `vo2max` | `daily-vo2-max` | `vo2Max` |
| `temperature_deviation` | `daily-sleep-temperature-derivations` | `nightly - baseline` |
| `sleep_minutes` | `sleep` (session) | `summary.minutesAsleep` |
| `steps` | `steps` | `dailyRollUp` → `steps.countSum` |
| `active_calories` | `active-energy-burned` | `dailyRollUp` → `activeEnergyBurned.kcalSum` |

**Skin temperature is the Whoop trap in a new coat.** Legacy Fitbit sent
`nightlyRelative`, already a deviation, so it mapped straight across. Google
sends an absolute nightly reading near 33 degrees plus a baseline, and
publishing the first as a deviation would put a body temperature on a chart
whose other points are fractions of a degree. The adapter subtracts, and
reports nothing at all when there is no baseline: a gap beats an invented
number. `googleTemperatureDeviation()` is tested for exactly this.

**Two traps that went away.** VO2 max is a plain number now, so the legacy
band-parsing (`"44-48"` → 46) is gone. Distance is unambiguous rather than
locale-dependent, though it is in **millimetres**: reading it as metres turns a
5km run into 5,000km.

**Still no sleep score**, for the same reason as before. Google Health exposes
none, and publishing sleep efficiency under `sleep_score` would put a number
beside Oura's that means something different.

#### The OAuth details that would have killed it silently

**`access_type=offline` and `prompt=consent` are mandatory.** Google issues no
refresh token at all without the first, and sends one exactly once per grant
without the second. Miss either and a connection works for an hour and then
dies, with nothing in the logs tying the failure to the cause. This is Whoop's
`offline` scope wearing different clothes, and that one cost a day. Providers
gained `extraAuthParams` for it, applied last in the connect route so a vendor
cannot override `state` or `redirect_uri`.

**Google does not rotate refresh tokens.** The refresh response omits the field
entirely. `tokenColumns` already refuses to blank a token a vendor did not
send, so this is safe, but `refreshRotates: false` records what is true rather
than what is convenient. It is the only provider with that flag, and a test
pins the exception so a future one gets reviewed.

**Three scopes, and the collapse matters.** `heartrate`, `oxygen_saturation`,
`respiratory_rate` and `temperature` were four separately declinable Fitbit
scopes and are now one Google bundle. A member used to be able to decline SpO2
and keep HRV; now those four arrive or refuse together. Each collection is
still fetched defensively, but what that protects against has changed shape.

**`recordingMethod` is a better auto-detected signal than the legacy API had.**
Fitbit's `logType` needed matching against a list of strings; Google state it
as an enum, so `PASSIVELY_MEASURED` means the device noticed the session and
anything else means a person was involved. That maps straight onto migration
0021's `auto_detected`. `UNSPECIFIED` and `UNKNOWN` are not treated as
auto-detected, keeping the rule that false means "they do not say".

**The provider id stays `fitbit`.** Members think Fitbit, the redirect URI is
registered against `/api/wearables/callback/fitbit`, and
`wearable_connections.provider` already uses it. Google Health is the pipe, not
the brand.

#### What is still needed before it can be connected

A Google Cloud project with the Health API enabled, an OAuth Web Server client
whose redirect URI is `https://app.ikigaro.com/api/wearables/callback/fitbit`,
the three scopes on the Data Access page, and the client id and secret set as
Cloudflare Secrets. **Registration follows the code, which is now written.**

Two constraints to plan around rather than discover: an unverified client caps
at **100 test users** and needs a third-party security review beyond that, and
while the client is unpublished **refresh tokens expire after 7 days**, so a
tester silently drops after a week. Publish before anyone relies on it.

---

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

**And Whoop cannot be made to say.** Checked against their own v2 workout model
on 2026-08-08, after a Whoop was connected for testing. The complete field list
is `id`, `v1_id`, `user_id`, `created_at`, `updated_at`, `start`, `end`,
`timezone_offset`, `sport_name`, `score_state`, `score` and the retired
`sport_id`. There is no detection flag, and no field that stands in for one, so
a walk their watch noticed arrives looking exactly like a session the member
began. Left alone, the Fitbit trap returns wearing a Whoop strap.

The fix does not guess at detection, because guessing would put a fact in the
database that no vendor told us. It asks the question this app already has an
answer for. `AMBIENT_BUCKETS` in `src/lib/training.ts` holds one entry,
`walking`, and a device walk counts as movement UNLESS the member logged a
walking activity in their own check-in that day, in which case it is training
because they said it was. The check-in is the record of intent, which is the
same line drawn in the paragraph above, applied where the vendor is silent.

**Only walking is in that set.** Hiking is its own type and nobody hikes by
accident; running and cycling are never ambient. Adding an entry means claiming
a whole category is usually unintentional, which is a strong claim and should
be made one activity at a time.

A retired provider still gets a row in Settings when somebody is connected to
it, with Disconnect and no Connect. `unavailable` removes a provider from the
connect list, and on its own that would strand anyone already connected: no
row, no Disconnect, no way to revoke a grant we can no longer sync. **Retiring
an integration must never take away the exit.**

The Training card shows movement on its own line, in its own words, never
summed into the training numbers.

#### A day without training is one of three things

Rest days used to be `windowDays - trainingDays`, which meant every day without
a session was rest. The founder caught it from the card itself: one deliberate
rest day plus two missed check-ins read back as three rest days. **That is the
app inventing an intention out of its own ignorance**, and the product already
had the honest definition elsewhere, in `activityLabel()` on the share card,
where a rest day is a check-in that says `training_logged: false`.

So `trainingLoad()` now splits the untrained days three ways:

| State | Test | Reported as |
|---|---|---|
| Rested | a check-in exists for that day and produced no training | `restDays` |
| Not logged | no check-in at all | `unloggedDays` |
| Today | the last day of the window | neither |

Absence of evidence is not evidence of rest, the same rule `summarizeCheckins`
follows when it refuses to read a missed check-in as a zero.

**The last day of the window is never judged.** The route ends the window at
`todayUTC()`, so at nine on a Monday morning that day has had no chance to
contain anything: counting it as rest or as a missed check-in is a verdict on a
day that has not happened. It can still count as trained, because a session
already logged today is a fact. The three states and the training days add up
to `windowDays - 1`, and there is a test asserting exactly that, because a day
falling into two buckets or none is the failure mode here.

#### The trap that WAS: VO2 max as a string, sometimes a range

> **Historical.** This described the legacy Fitbit Web API and the
> `fitbitVo2Max()` helper, both of which the Google Health rewrite deleted on
> 2026-08-07. Google send `vo2Max` as a plain number. Kept because it is the
> clearest example in this repo of a vendor field whose TYPE is the trap.

Fitbit's legacy VO2 max was a string and was sometimes a range: their own
examples returned both `"45"` and `"44-48"`, the single number only when the
member ran with GPS. `Number("44-48")` is `NaN`, so passing it through the
ordinary numeric helper dropped every ranged reading silently, and the metric
looked like it simply never arrived for anyone who did not run with GPS. The
fix took the midpoint, which is the honest reading of a band and keeps the
series continuous when a member moves between the two forms.

**The lesson outlived the code.** A vendor field can be the wrong TYPE rather
than the wrong path, and a numeric helper that returns undefined on a malformed
string will hide that forever.

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
`APP_ORIGIN` there. **Nobody has**, and as of 2026-08-18 staging also has none
of the wearable schema (it stopped at migration 0014), so staging cannot
exercise a wearable flow at all. The first connection for a new provider
therefore happens in production with your own account. See
[`STAGING.md`](./STAGING.md), which now says so rather than implying otherwise.

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
POLAR_CLIENT_ID / POLAR_CLIENT_SECRET
COROS_CLIENT_ID / COROS_CLIENT_SECRET     # set these and COROS still stays
                                          # hidden: its `unavailable` reason
                                          # wins over credentials, on purpose
```

**Setting a pair is what makes a provider appear**, so it is a deploy-shaped
act rather than a config change. `providerConfigured` returns true as soon as
both are present, and the connect UI lists whatever it returns. The one
exception is a provider carrying an `unavailable` reason, which stays hidden
regardless; that is the difference between "we have keys" and "this works".

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
database on its own is not enough to impersonate our users against eight vendors.

---

## How it runs

| Piece | Where |
|---|---|
| Nightly sweep | `GET /api/cron/sync-wearables` (CRON_SECRET bearer), 02:00 UTC, 07:30 IST |
| Sync on connect | the OAuth callback, before it redirects |
| Manual sync | `POST /api/wearables` `{action:"sync"}`, from Home and from Settings |
| Per-device raw view | `GET /api/wearables/device?days=7`, Trends |
| Garmin push | `POST /api/wearables/garmin-push` |
| Connect / disconnect | Settings → Connected devices |

**Syncing on connect is not a nicety and it already existed.** The callback
pulls before it redirects, so a member lands back in the app with data on the
screen rather than an empty card and no way to tell success from failure. It is
best effort: a failure there is not a failure of the connection, and the sweep
retries within the day.

**The schedule is stated in the product, not just here.** Home carries a sync
control once anything is connected, with an information icon that names the
07:30 IST run in words. Before that, "why is there nothing here" and "is this
broken" were the same question with no answer in the app.

The sweep re-pulls a **fixed recent window** (7 days, 14 for Withings) rather
than tracking a high-water mark. Two windows, not one: a connection that has
never completed a sync takes `backfillWindowDays` instead (60, Whoop only), so
a member's own history is on the screen they land on after connecting rather
than arriving a day at a time. The manual "Sync now" button forces that wider
window too, which is the only route by which a member who was already connected
when the backfill shipped can ever reach it: they have a `last_sync_at`, and
reconnecting deliberately does not clear it. Every one of these vendors revises data after
the fact, a sleep score finalises hours later, a watch that was offline
backfills days at once, so a window plus an idempotent upsert is both simpler
and more accurate than a cursor that would silently miss every late arrival.

It is bounded per run and ordered by `last_sync_at` ascending, so it cannot
outgrow the Worker's CPU budget and nobody can be starved.

### Request budgets are per app, not per member

WHOOP allow **100 requests a minute and 10,000 a day across every member we
have, together**. The sweep walks connections one after another, so at ten
members it is nowhere near that and at a hundred and fifty it would be roughly
two hundred a minute. Nothing warns you on the way: the run simply starts taking
429s partway down the list, and the members at the end of the list are the ones
who stop having data.

`rate-limit.ts` holds both halves of the answer. **Pacing**: every response
carries the remaining budget, and when it drops below ten we space out what is
left over the time until it resets, capped at two seconds so a member watching a
"Sync now" spinner never waits on it. **Stopping**: when the budget is gone,
`providerFetch` raises `RateLimited` before sending anything, and `syncDue`
pauses that vendor for the rest of the run rather than collecting a 429 per
remaining member.

**A rate limit costs the connection nothing.** This is the part that matters.
Before it, a 429 was an ordinary error, so it incremented `failure_count`, and
five nightly sweeps that ran out of budget before reaching the same member
marked their connection `expired` and asked them to reconnect a device that had
never failed. `classifyFailure` in `sync.ts` now separates "whose fault is this"
from the writing of it: a rate limit writes nothing at all, and leaves
`last_sync_at` alone so the member is at the FRONT of the next run.

The store is per Worker isolate, so two concurrent invocations do not see each
other's counters. Acceptable while the sweep is one scheduled run and the manual
path is one member pressing a button; coordinating properly needs a Durable
Object or KV, and is worth building when a second concurrent sweep exists.

### Two devices, one number: the member decides (migration 0022)

`mergeMetrics` picks one source per metric per day by a ranked preference,
never an average. That ranking is ours, it is defensible, and it is
**invisible**: a member reads 6h50m on our screen, 7h12m in Whoop's own app,
and has no way to tell a rule from a bug.

So the ranking became a default rather than a verdict.
`wearable_source_preferences` holds one row per member per metric family, and
`mergeMetrics(rows, prefs)` promotes the chosen provider to the front.

**Per family, not per metric.** Sleep, HRV, resting heart rate, readiness,
respiratory rate and blood oxygen come off the same device on the same night.
Four families, matching the four rankings that already existed: `sleep`,
`movement`, `body`, `glucose`. `SOURCE_RANK` is now DERIVED from `METRIC_FAMILY`
rather than written out a second time, so a new metric cannot rank by one rule
and take its preference from another.

**A preference is a promotion, not a lock.** The chosen provider sorts first and
the rest keep their order behind it, so a night the preferred device missed is
still filled by the next best. Read as a filter it would cost a member every
night their ring was on the charger, which is the opposite of why anyone owns
two devices. There is a test named for exactly that property.

**No row is written automatically.** A member with one device needs no
preference: the merge already picks the only source there is, and the settings
screen says so in a sentence instead of offering a control. Writing a row on
connect would lock in a device chosen before there was anything to choose
between.

**The picker appears only where a choice exists.** A family is offered only once
two connected devices have actually reported in it within thirty days. Every
provider appears in every ranking, so "who is connected" would have offered a
Whoop and Oura owner a choice of glucose source, for a number neither device
measures.

**Every merge call site must pass the same preferences.** Four of them exist:
Trends, the training card, Future You and the per-device panel. One of them
merging without the member's choice would make that screen disagree with the
others invisibly, because both numbers are real readings from real devices.
`loadSourcePreferences` is the only reader and it never throws: a failed read
degrades to the default ranking rather than emptying somebody's Trends.

Disconnecting prunes any preference naming the departed device, after the
delete and best effort, because tidying must never be able to fail a
disconnect.

### The definitions matter more than the source label

The commonest way our screen disagrees with a vendor's app is **not** the merge.
It is the two of us defining the same word differently, and it happens with one
device connected and no merge involved: our `sleep_minutes` is light plus deep
plus REM, so it reads lower than an app whose headline figure is time in bed.

Naming the device cannot explain that. Only a definition can. `METRIC_NOTES` in
`metrics.ts` carries one sentence per metric, rendered in the per-device panel.

They are **definitions, never interpretation**: "time actually asleep", not
"good sleep is above seven hours". A test asserts that none of them contains
advice wording, in the same spirit as the training card's.

### The per-device panel is provisional, on purpose

`GET /api/wearables/device` and `DeviceDetail` in Trends show what ONE device
sent, unmerged, collapsed by default. It exists because two questions had no
answer inside the app: "your number and Whoop's app disagree" and "I just
connected this, is it working". Every point carries `used`, which says whether
that day's number is the one Trends shows, so a member who has two devices can
see which one won a given night instead of finding a mismatch and assuming a
bug.

**It is a trial.** It was built to be looked at and then kept or removed, and
it is deliberately self-contained: one route, one component, one line in
`trends-view.tsx`. Deleting all three removes it completely and touches nothing
else. If it survives the trial, delete this paragraph.

It never returns a token, and the columns are named rather than starred, for
the same reason the connections route does that.

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

## Adding a ninth provider

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
| Oura | yes | `POST /oauth/revoke?access_token=`, falling back to GET |
| Ultrahuman, Withings, Garmin | no | No revoke endpoint found in their documentation. |

**Oura's URL took a human to obtain**, which is worth remembering next time. It
lives in a code block that every extractor available here strips out of the
page, so the endpoint sat unimplemented for a day rather than being guessed at.
Read off `api.ouraring.com/docs/authentication` on 2026-08-07.

Two things their docs do not say, both handled rather than assumed. The
**method** is not stated: RFC 7009 says revocation is a POST and a
state-changing call should not be a GET, so POST goes first, and a 404 or 405
retries once as GET, because their example is a bare URL with a query string
and no body, which is equally consistent with either. The **prose mentions
`client_id`** while the URL they print carries only `access_token`; we send
what the example shows, since adding an undocumented parameter is the same
guess in a smaller costume.

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

## Pending integrations: Withings and COROS

Polar has since shipped and moved out of this section; its record is below and
in [`POLAR_ACCESS.md`](./POLAR_ACCESS.md).

Three named on the roadmap, in the order they are worth doing. Access model
first, because it decides the sequence far more than engineering effort does.

| Vendor | Access | State | What it adds |
|---|---|---|---|
| **Withings** | Registered, credentials in hand | **Adapter written, NEVER AUDITED** | Weight and body composition, plus sleep |
| **Polar** | **Registered 2026-08-18, credentials live** | **Adapter shipped, never run against a real account.** Built from their v4 `swagger.yaml`; see [`POLAR_ACCESS.md`](./POLAR_ACCESS.md) | Sleep with stages and a sleep score, HRV, breathing rate, steps, workouts |
| **COROS** | **Applied 2026-08-18**, form submitted and email sent, awaiting their review | **Adapter written from their V2.0.6 reference guide, never run against a live account.** Hidden by `unavailable` until credentials exist | Steps, resting heart rate, overnight HRV, workouts |

### Withings first, because it is the only one already paid for

The adapter exists and the credentials exist. It is also **the one adapter
never checked against its vendor's documentation**, and four of four that were
checked turned out wrong in the same way. So the work is an audit, not an
integration, and it is short.

It is a scale rather than a wearable, which is why it keeps losing to more
useful work: it contributes weight and body fat and nothing to training or
recovery. **Do not register anything further for it before reading the adapter
against Withings' docs.**

### Polar shipped 2026-08-18, and four things about it are unlike everything else

Built from their **AccessLink Dynamic API v4** `swagger.yaml`. Registration is
self-serve with no approval period, so this is the only vendor here where the
whole thing was inside our control. `POLAR_ACCESS.md` has the full record; the
four things worth knowing before touching the adapter:

1. **There are two Polar APIs and this is the other one.** Every tutorial, every
   community client, and Polar's own published example application target v3
   "Open AccessLink": a transaction model, and a mandatory `POST /users` to
   register each member before any read works. v4 has none of that. **The token
   URL in circulation is v3's**: `polarremote.com/v2/oauth2/token` is what every
   source says, and the v4 spec names `auth.polar.com/oauth/token`.
2. **Their tokens expire in 12 hours**, and a widely-syndicated write-up says
   they never do. We had recorded the write-up's version. That would have shipped
   an integration that works until lunchtime.
3. **`features` decides whether you get data at all.** Without it every endpoint
   returns dates and no numbers; with it a request is capped at one day. So a
   seven-day sweep is seven requests per data type, and there is deliberately no
   backfill window: 90 days of history would be 360 calls for one member against
   a 3,000-per-15-minutes budget.
4. **There is no daily step total.** Activity returns step samples per device and
   the total is ours to compute, taking the highest device rather than the sum,
   because two devices counted the same walk.

Also: durations are strings (`"80s"`), and Polar's rate-limit headers count
**usage** where everyone else counts **remaining**, which `parseRateLimit` now
converts. Reading one as the other is the exact inverse.

Deliberately unmapped: resting heart rate (they give a four-hour mean, our screen
promises the overnight low), readiness (their 1-6 scale has an ambiguous top and
normalising it would be a formula we invented), and workout sport names (an id
with no name, needing a scope and a catalogue fetch we can add later). **No
`revoke`**: v3 had one, v4's spec has no equivalent path, and a guessed revoke
URL is a privacy claim we cannot support.

### COROS: the adapter is written, and four things in it are unlike everything else

**Written 2026-08-18 against their API Reference V2.0.6 (February 2026),** which
arrived with the application rather than from a public site. The application
went in the same day: the Feishu form and an email to their developer contact.
Nothing here has spoken to a COROS server. The provider carries an
`unavailable` reason so that setting `COROS_CLIENT_ID` and `COROS_CLIENT_SECRET`
does **not** switch it on, and the tests in `coros.test.ts` pin what their
documentation says, which is a weaker claim than what their servers do.

Four differences, each of which would have been a silent failure if guessed:

1. **The token is a query parameter, not a bearer header,** and every data call
   also needs `openId`, their user identifier. It arrives in the token response
   and lives in `external_user_id`. A connection without one cannot be read at
   all, so `fetchRange` returns empty rather than spending a request to earn an
   error.
2. **A refresh extends the existing token and issues nothing.**
   `POST /oauth2/refresh-token` answers `{"result":"0000","message":"OK"}` and
   adds one month to the token you already hold. `RefreshToken never expires`,
   in their words. Generic refresh code throws "returned no access_token" on
   that response, which is a *complete success*, and kills a working grant. This
   is what `refreshExtendsToken` and `extendToken()` in `sync.ts` exist for.
3. **Success is in the body, not the status code.** Every endpoint returns HTTP
   200 with a `result` field, and only `"0000"` means it worked. An adapter
   reading the status alone would treat a refusal as an empty day, which looks
   exactly like a member who did not wear their watch.
4. **Thirty days per query, three months of history.** "The maximum date range
   for one query is 30 days, and the query date is not earlier than three months
   before the day." So `corosWindows()` chunks a range, a 90-day backfill is
   four requests, and no backfill can reach further back than a quarter however
   it is asked. Their documented limit is 1,000 calls per minute, which this is
   nowhere near.

**Their `result` codes have no documented vocabulary.** `"0000"` is the only
value the guide defines, so a member who revoked us at COROS and a COROS having
a bad afternoon arrive as the same opaque string. Section 3.5 is the one
question that separates them: `bindState` is 1 while the token exists and the
member has not unbound it, "regardless of whether the token has expired". So a
failed data call asks `bindState` once, and **only a clear zero** becomes
`ReauthRequired`. Anything else, including a second failure, leaves the original
error alone, because "we could not tell" must not read as "the grant is dead".

Their token response is documented in **two spellings at once**: the parameter
table names `accessToken` / `refreshToken` / `expiresIn`, and the worked example
three lines below returns `access_token` / `refresh_token` / `expires_in`.
`requestTokens` reads both. Their OAuth also defines **no scopes at all**, which
is why `connect/route.ts` omits the parameter entirely rather than sending
`scope=`.

#### Two things COROS report that we deliberately do not store

**Sleep is not mapped, and this is the most consequential decision in the
adapter.** They give a window, `sleepStartTime` to `sleepEndTime`, with no
stages. Our `sleep_minutes` is defined on the member's own screen as time
actually asleep, light plus deep plus REM, which reads lower than time in bed. A
window is time in bed. Publishing it under that key would make the definition we
show people false for COROS members, and would put two different quantities on
one chart for anybody wearing two devices. Their own example makes the case: it
contains a night running from 2020-06-15 22:00 to 2020-06-18 08:00, which is
either a typo or fifty-eight hours of sleep, and nothing in the payload
distinguishes them.

The honest fix is **a separate metric for time in bed**, which is a vocabulary
change worth making deliberately rather than smuggling in with an adapter. It
is not done. Until it is, COROS members get steps, resting heart rate and HRV,
and the provider blurb says exactly that and does not mention sleep.

**Calories are not mapped either,** for a simpler reason: the unit cannot be
determined. Their table says "Unit: calorie", and their example pairs 9,553 of
them with 52 steps, which is impossible as kilocalories and absurd as calories.
**Verify against a real member's day before publishing a number nobody can
check.** This is the first question to settle once credentials arrive.

Only the **parent** workout type is mapped to a name. Their table pairs a parent
with a child for every variant (outdoor run, indoor run, pool swim, open water),
and carrying all of it would distinguish things our vocabulary does not: a
workout activity is free text, shown as the vendor's own label. An unmapped code
yields **no** label rather than a wrong one, because the member reads a label as
what their watch recorded. Codes 98 and 99 are "custom sport" and the name the
member gave it is not in the payload, so they stay unmapped on purpose.

`startTimezone` counts **15-minute steps**, so 32 means UTC+08:00. Sessions are
filed to the day they started **in the member's own timezone**; a 06:00 session
in India filed by UTC lands on the previous day, which is how a training week
quietly loses a Monday.

### COROS is less gated than we recorded

**Corrected 2026-08-17.** This section used to file Coros with Garmin and
Ultrahuman, as an application and somebody's judgement. Their own page now
describes a "standardized, objective developer onboarding process" granting
access "to any platform that satisfies our standard security and operational
requirements", attributed to GDPR and the EU Data Act. No fee is mentioned. A
vendor granting access because regulation obliges them is a vendor whose answer
does not turn on how interesting they find us, so the failure mode we planned
around, being quietly declined for being small, is not the one described.

**The documentation is private**, which is why applying came before writing
anything: credentials are issued after verification. The reference guide
arrived with the application form rather than after approval, which is what
made the adapter above possible ahead of credentials. See `COROS_ACCESS.md` for
the application itself and for what to ask them while they have their hands on
the keyboard.

There is a widely-shared Node project that drives Coros' Training Hub through a
non-public endpoint, and its own README warns it "could break anytime". **That
is not an option here**, and the reason is stronger than fragility: those
projects authenticate with the member's own Coros email and password. An
undocumented endpoint underneath a health record is a data-integrity risk; a
stored vendor password is a category of credential this app has deliberately
never held.

### What "pending" means in the device request list

`src/lib/device-requests.ts` recognises both names already, and both now sit
under "Public API, no adapter yet" with a reason, rather than under "No public
API today" where they wrongly sat for weeks. The distinction is visible in the
admin console: a request for a queued device is a roadmap item, while a request
for a blocked one is an answer we can give the member today.

---

## Deliberately not done yet

- **Nothing is surfaced in Future You.** Trends now shows merged device series
  and a Training and recovery card; the habit model still reads only check-ins.
  What device data should *say* there is a product question worth answering
  with real data in hand rather than guessing at now.
- **Wearable data earns no points.** Steps are trivially spoofable and paying
  for them invites exactly that. If this changes, pay for *connecting* once, not
  for the numbers.
- **Backfill on first connect is Whoop only.** 60 days, and it needed
  pagination to be true rather than merely requested. Oura, Fitbit, Google
  Health and Withings all cap a page and return a continuation token their
  adapters do not follow, so each is its own piece of work.
