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

`https://whoopinc.typeform.com/to/XmzituEp`. WHOOP ask for "designs and other
helpful context". Draft answers below. Paste and edit; do not send anything here
that has stopped being true.

### What the app does

> Ikigaro is a consumer wellness app that helps people read their own blood work
> and see what actually moves it. Members upload a lab panel, log a 30-second
> daily check-in, and connect a wearable. We put the three side by side: what
> your last panel said, what you have done since, and what your body has been
> doing while you did it.
>
> WHOOP is what makes the third of those honest. Sleep, recovery, HRV and
> resting heart rate are the measurements that connect a habit to a lab result,
> and asking somebody to self-report them produces a number nobody should build
> on.

### How WHOOP data is used

> We read daily summaries through the v2 API: sleep (`/activity/sleep`),
> recovery (`/recovery`) and workouts (`/activity/workout`).
>
> Members see their own readings in Trends, both merged across every device they
> have connected and, in a separate panel, exactly as WHOOP sent them, day by
> day. That second panel exists so that a member who sees a different number in
> the WHOOP app can find out why rather than concluding one of us is broken. Our
> sleep figure is light plus deep plus REM, and we say so on the screen, because
> that is the commonest reason the two disagree.
>
> Device data is never used for advertising, is never sold, earns no rewards
> points, and is never shown to anyone but the member it belongs to.

### Data handling and privacy

> Privacy policy: https://app.ikigaro.com/privacy (section 1 covers connected
> wearables specifically: what we read, what we do not, and what disconnecting
> does).
>
> Access and refresh tokens are encrypted before they are written and are never
> returned to the browser by any endpoint. On disconnect we call WHOOP's
> `revokeUserOAuthAccess` and then delete our copy of the credentials outright.
> Members can have all their data erased on request, which the policy states.
>
> We request five scopes and no more: `read:sleep`, `read:recovery`,
> `read:cycles`, `read:workout` and `offline`. We do not request `read:profile`,
> because we call no profile endpoint and do not want a member's name or email.

### Scale and status

> Live at https://app.ikigaro.com, in closed beta, single-digit members today.
> Operated by Avisa Innovation LLP, Pune, India. We are submitting now rather
> than at the cap because approval is reported to take a while, and because we
> would rather be reviewed on a small honest integration than a rushed large
> one.

### Designs to attach

Take these on a phone, with the WHOOP data live, in whichever theme looks best:

1. **Trends, "From your devices"** with the WHOOP attribution visible in the
   card header.
2. **Trends, "What your WHOOP says"** expanded, showing the day-by-day readings.
3. **Home**, showing the "Sync with WHOOP" control and its information popup.
4. **Profile, connected devices**, showing WHOOP connected with a Disconnect
   control.
5. **The WHOOP consent screen itself**, as a member sees it, which shows the
   five scopes we ask for.

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
