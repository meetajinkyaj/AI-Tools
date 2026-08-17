# WHOOP app approval: what to check, and what to write

Everything needed to submit Ikigaro for WHOOP app approval, in the order WHOOP
themselves set out. Their process is five steps, four of which are ours to get
right before the fifth (the form) is worth filling in.

Source: `developer.whoop.com/docs/developing/app-approval`, read 2026-08-12.

> "Apps can be used for development immediately with a limit of 10 WHOOP
> members. To launch your app to all WHOOP members, you must first submit your
> app for approval."

**Why bother now.** Ten members is the cap until they approve, and the queue is
reportedly long (see `WEARABLES.md`, "The cap is the strategic finding"). Joining
it costs an hour and nothing else. Do not build a launch plan that assumes the
cap lifts on any particular date.

---

## Step 1. The API Terms of Use

Read them at `developer.whoop.com/api-terms-of-use/`. Two clauses shape what we
already do:

- **Brand elements (clause 1).** We may display WHOOP's name for the sole
  purpose of saying we use their API, must show any attribution their
  documentation requires, and must follow their brand guidelines. Step 4 below.
- **HIPAA (clause 8).** WHOOP make no representation that the API meets HIPAA
  obligations and do not intend it to create any. Ikigaro is a consumer wellness
  product and not a covered entity, which the privacy policy already states in
  section 3, so nothing here conflicts. Do not describe the product to WHOOP as
  clinical or diagnostic; it is not, and the app's own disclaimer says so
  ("Educational, not a diagnosis. Please consult a doctor.").
- **Advertising (clause 5).** WHOOP data must not appear in advertisements
  without their written consent, and nothing may imply their endorsement. The
  share card carries habit data only and never device readings, which keeps this
  clear by construction.

## Step 2. Tested with at least one WHOOP member

**Satisfied.** A real WHOOP account with an active membership has been connected
to production since 2026-08-08, and sleep, recovery, HRV, resting heart rate,
blood oxygen and respiratory rate have all arrived through the v2 API. Before
submitting, press "Sync with WHOOP" once so the 60-day backfill runs, and check
that Trends shows more than the last few days.

## Step 3. Developer Dashboard fields

WHOOP call these out by name as the things that accelerate a review. Check them
at `developer-dashboard.whoop.com`:

| Field | What it should say |
|---|---|
| App Name | `Ikigaro` |
| Contact Email(s) | `hello@ikigaro.com` (add a second if anyone else should get review mail) |
| Privacy Policy URL | `https://app.ikigaro.com/privacy` |
| Redirect URI | `https://app.ikigaro.com/api/wearables/callback/whoop` (byte for byte, no trailing slash) |
| Scopes | `read:sleep`, `read:recovery`, `read:cycles`, `read:workout`, `offline` |

The scope list is deliberately short of `read:profile` and
`read:body_measurement`. WHOOP's own guidance is to request only what the app
uses, and a reviewer comparing the consent screen against the product is the
person most likely to notice that we do.

## Step 4. Design and brand guidelines

From WHOOP's brand guide (`developer.whoop.com/docs/developing/design-guidelines`):

> "Attribution: Ensure that any data from WHOOP communicates it as such.
> Examples include: Data by, Imported from, Data by, Powered by."

**Where we attribute today**, all of it in the member's own words rather than a
badge:

- Trends, "From your devices": the header names the device, for example
  `WHOOP · Yesterday · 2 days`. With two devices connected the name moves onto
  each individual reading, because then it answers a real question.
- Trends, the per-device panel: titled "What your WHOOP says", and every reading
  in it is that device's, unmerged.
- Home: the sync control reads "Sync with WHOOP".
- Profile: the connected-devices list names each provider.

**The wordmark is set in caps everywhere it appears**, matching every surface
WHOOP publishes. `PROVIDER_NAMES` in `src/lib/wearables/types.ts` is the single
source for it.

**We do not use their logo at all**, which sidesteps the whole of their DON'T
list (no distortion, no recolouring, no rotation, no placing a logo next to
their visualised data). If a reviewer asks for the mark rather than the name,
their approved SVG/PNG pack is linked from the design-guidelines page. Adding it
is a small piece of work, not a rewrite.

**Their typography preferences (Proxima Nova for words, DINPro for numbers) are
for WHOOP's own brand communications**, not a requirement placed on integrating
apps, and Ikigaro has its own type system. Nothing to change.

## Step 5. The submission form

`https://whoopinc.typeform.com/to/XmzituEp`. Four required questions, answered
below in the order the form asks them. Paste and edit; do not send anything here
that has stopped being true.

### 1. "Please outline your intended use of the WHOOP API."

> Ikigaro helps people read their own blood work and see what actually moves it.
> A member uploads a lab panel, logs a 30-second daily check-in, and connects a
> wearable; we put the three side by side, so what they did shows up next to
> what their body did and what their next panel says.
>
> WHOOP is what makes that honest. Sleep, recovery, HRV and resting heart rate
> are the measurements that connect a habit to a lab result, and asking somebody
> to self-report them produces a number nobody should build on.
>
> We read daily summaries from three v2 collections: `/activity/sleep`,
> `/recovery` and `/activity/workout`. Members see their own readings in Trends,
> both merged across every device they have connected and, in a separate panel,
> exactly as WHOOP sent them, day by day. That second panel exists so somebody
> who sees a different number in the WHOOP app can find out why rather than
> concluding one of us is broken: our sleep figure is light plus deep plus REM,
> and the screen says so.
>
> Device data is never sold, never used in advertising, never shown to anyone
> but its owner, and earns no rewards points. Ikigaro is a consumer wellness
> product, not a diagnostic one, and every screen says "Educational, not a
> diagnosis. Please consult a doctor."

### 2. "Please share a link to UX and/or designs for your integration."

> https://claude.ai/code/artifact/f26b17d5-67c6-45a1-9086-e447f5c892fb

A page showing both WHOOP screens, the five scopes with the reason for each, the
sync sequence, what we never do with the data, and how the WHOOP name is used.
**It has to be shared before it is submitted**: the page is private until it is,
and a reviewer who cannot open the link is worse than no link.

### 3. "What is your preferred timeline for releasing the integration to your users?"

> Q4 2026. The integration is built and running in production today; what is
> ahead of it is our own public launch rather than any WHOOP work. We are in
> closed beta now, and WHOOP is live for the members who have one, which is how
> we would like it to stay through launch.
>
> We are submitting well ahead of that date deliberately. The ten-member cap is
> not a constraint at our size yet, and we would rather be reviewed on a small
> honest integration now than a rushed one the week we launch.

### 4. "Please share the expected number of users and the number of API calls per minute / per day."

> Today: one connected WHOOP member, in a closed beta with single-digit members
> in total, using roughly four requests a day.
>
> Per connected member, per day, in steady state: one token refresh plus three
> collection requests (sleep, recovery, workout), each a single 25-record page
> for a seven-day window. About four requests. A first connection, or a manual
> "sync now", pulls a 60-day backfill and follows `next_token`, which is about
> ten requests once.
>
> At our Q4 2026 launch we expect on the order of 500 members within six months,
> of whom we would estimate 100 to 150 are WHOOP members: roughly 400 to 600
> requests a day, plus about ten for each new connection.
>
> On the minute limit: our sweep runs once nightly at 02:00 UTC and processes
> connections serially, bounded per run. We read the `X-RateLimit-Remaining` and
> `X-RateLimit-Reset` headers on every response, slow down as the budget runs
> low, and stop a run cleanly when it is spent rather than collecting 429s.
> Members not reached are first in line on the next run. We would ask for an
> increase ahead of need rather than after being throttled.

### Screenshots, if the form or a reviewer asks for more

The design link above carries rendered screens. Real device screenshots are
better still, and these are the five worth taking on a phone with live data:

1. **Trends, "From your devices"** with the WHOOP attribution in the card header.
2. **Trends, "What your WHOOP says"** expanded, showing the day-by-day readings.
3. **Home**, showing the "Sync with WHOOP" control and its information popup.
4. **Profile, connected devices**, showing WHOOP connected with a Disconnect control.
5. **The WHOOP consent screen itself**, which shows the five scopes we ask for.

---

## Before pressing submit

- [ ] Dashboard fields match the table in step 3, exactly.
- [ ] `https://app.ikigaro.com/privacy` loads and its wearables section is live.
- [ ] "Sync with WHOOP" has been pressed once and Trends shows the backfilled
      history.
- [ ] Disconnect has been tested end to end at least once, since the form asks
      about data handling and the answer above claims it works.
- [ ] Nothing in the answers describes the product as clinical or diagnostic.

## After submitting

Record the date here. WHOOP's forum carries developers reporting a month or more
with no reply, so treat silence as normal rather than as a signal to resubmit,
and do not let the ten-member cap arrive as a surprise.

- Submitted on: _(fill in)_
- Reply received: _(fill in)_

---

## Shipped after submitting

Question 4's answer promised pacing against your published rate-limit headers.
It was built the same day rather than left as an intention: see `WEARABLES.md`,
"Request budgets are per app, not per member". The wording above has been
updated to describe what the code does, so if WHOOP ask about volume, that
section is the honest answer and this doc does not overstate it.

**The answer as originally submitted said "we will pace"**, in the future tense.
That was true when it was sent. If a reviewer quotes it back, the change is in
our favour and worth saying plainly.
