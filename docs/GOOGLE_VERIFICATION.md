# Publishing the Google OAuth client

Fitbit now authenticates through Google (see `WEARABLES.md`, "Fitbit moved to
the Google Health API"), so Fitbit support depends on a Google Cloud OAuth
client. That client is in **Testing**, and moving it to **In production** is not
a toggle. This is what it actually involves, what it costs, and what I would do.

Sources, all read 2026-08-17: `developers.google.com/health/app-verification`,
`developers.google.com/health/setup`,
`developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification`,
`support.google.com/cloud/answer/13464321`.

---

## The finding

> "Most scopes for the Google Health API are **restricted**, which means you must
> complete verification before your app is publicly available."

Restricted scopes put publishing behind **two gates, not one**:

1. **OAuth app verification.** Google's Trust and Safety team review the app's
   identity, every scope, and a written justification per scope. They also want
   a demonstration video and a compliant in-app disclosure.
2. **A CASA security assessment.** For restricted scopes this is an **annual**
   assessment by an accredited third-party firm against the OWASP ASVS, ending
   in a Letter of Validation you submit to Google. Self-assessment is no longer
   accepted. It is triggered because we store this data on our own servers.

Published figures for CASA are roughly **$500 to $4,500 a year** and **two to
six weeks**, depending on tier. Treat those as indicative rather than quoted:
the assessor sets the price, and Google's Trust and Safety team tell you which
tier applies when they get to your submission.

## What being unpublished costs today

- **100 users, and each one added by hand.** Test users are entered by email
  address on the Audience page. Not a constraint at our size.
- **Refresh tokens expire after 7 days.** This is the one that matters. Google:
  *"If your OAuth consent screen is configured with a 'Testing' publishing
  status, the refresh tokens issued are time-based and expire after 7 days."*
  A member who connects a Fitbit on Monday is disconnected by the following
  Monday, and the app can only respond by asking them to reconnect, every week,
  forever. Google's own advice is blunt: *"ensure you publish your application
  before it is moved into a production environment."* `app.ikigaro.com` is a
  production environment.

## The decision

**Fitbit is not worth $500 to $4,500 a year and a six-week security assessment
at single-digit members, and it is not safe to leave connectable in the
meantime.** Those two facts point the same way.

**Decided 2026-08-17: hidden until verification.** The credentials were set, so
Fitbit was showing a Connect button on production to members who would have been
disconnected seven days later, and no current tester owns a Fitbit. The `fitbit`
adapter now carries an `unavailable` reason, which `providerConfigured()` already
treats as decisive regardless of credentials, so it is gone from the connect
list. Deleting that one field is the whole of the change when verification
lands; the adapter and its credentials are untouched and correct.

**Start verification** when Fitbit turns out to be a device testers actually own,
or when launch is close enough that the annual cost is worth carrying.
Everything below is what you will be asked for.

Withings, Polar and Coros are all self-serve with no equivalent gate, which is
why they are the cheaper way to widen device coverage. WHOOP has a review but no
fee. Google is the only integration on the list with a recurring cash cost.

---

## What verification asks for, when you do it

### Already done, in code

- **The in-app disclosure.** Google is specific: inside the app, not only on a
  website or in a policy; visible in normal use rather than behind a menu; names
  the data and says what it is for; not mixed with unrelated disclosures. It
  sits in `wearable-settings.tsx`, in its own paragraph, on the screen where
  somebody decides to connect a device.
- **The Limited Use statement**, in the privacy policy's wearables section,
  naming the Google API Services User Data Policy and linking it.
- **A privacy policy that describes wearable data specifically**: what is read,
  what is not, what it is used for, and what disconnecting does.

### Still to produce

- **A scope justification, one per scope, specific.** Google warn that vague or
  duplicated justifications cause delays. Drafts:

  | Scope | Justification |
  |---|---|
  | `googlehealth.sleep.readonly` | Shows the member their own nightly sleep duration and sleep score in Trends, and feeds the training-load card that compares recent training against recent recovery. Sleep is one of the two measurements the product's core feature depends on. |
  | `googlehealth.health_metrics_and_measurements.readonly` | Shows resting heart rate, heart rate variability, respiratory rate and blood oxygen in Trends beside the member's lab results, which is the comparison the product exists to make. |
  | `googlehealth.activity_and_fitness.readonly` | Shows steps, active energy and exercise sessions, used to distinguish deliberate training from ambient movement in the training-load card. |

- **A demonstration video** showing the app functionality that uses those
  scopes: the consent flow, then Trends with the data in it, then disconnecting.
  Record it on the real app with a real account.
- **Verified ownership of `ikigaro.com`** in Google Search Console, under the
  same account that owns the Cloud project.
- **A homepage that explains the app**, reachable and matching the client's
  registered details.

### Then the assessment

Google's Trust and Safety team tell you when CASA applies and how to start it.
Budget for it annually rather than once: the Letter of Validation expires a year
from approval, and letting it lapse takes the app back to unverified.

---

## Decided 2026-08-19: submit for the reduced scope, and do the free half now

**The adapter now requests one scope, `activity_and_fitness.readonly`, instead
of three.** Steps, active energy, workouts and VO2 max. No sleep, no heart-rate
family.

**Why activity and not one of the others.** It is the scope most likely to sit
on the sensitive side rather than the restricted one: step counts and workouts,
the direct descendant of Google Fit's old `fitness.activity.read`, rather than
the clinical-shaped data in the other two. That is a judgement and not a fact,
which is what the console check above is for. If activity turns out to be
restricted anyway, the reduction bought nothing and the decision reverts to
whether Fitbit is worth an annual fee.

**VO2 max survives the cut, which is not obvious.** Under the legacy Fitbit API
it lived in `cardio_fitness`, and Google fold `activity` AND `cardio_fitness`
into `activity_and_fitness.readonly`. Filed with the heart-rate family by eye,
it would have been dropped silently. A test pins it.

**The adapter no longer calls what it has no scope for.** It reads the granted
set off the connection, so a member who declines a scope, or a reduced request
like this one, stops the useless calls rather than absorbing a 403 per
collection per member per night. `fetchWorkouts` returns empty rather than
calling, because a 403 there is not tolerated further down and would mark a
healthy connection expired.

### What is still hidden, and what would unhide it

The `unavailable` flag stays on until the client is published, because the
seven-day refresh token expiry in Testing mode has not changed. Publishing is
what removes it, and verification is what allows publishing. Deleting that one
field remains the whole of the change.

### The free half, in order

Everything here costs time and no money. None of it expires, so doing it now
means that whenever Fitbit becomes worth having, the wait is Google's queue and
not ours.

1. **Confirm the scope classification** in Google Cloud Console, as above. This
   is first because it can invalidate the rest.
2. **Verify `ikigaro.com` in Google Search Console**, under the same account
   that owns the Cloud project. Minutes, permanent, and a hard prerequisite.
3. **Check the homepage** is reachable, explains what the app does, and matches
   the client's registered details. Google reviewers do open it.
4. **Fill in the OAuth consent screen** completely: app name, support email,
   logo, the homepage, the privacy policy link, the authorised domain.
5. **Paste the scope justification** below.
6. **Record the demonstration video.** See the note about who can record it.
7. **Submit.** Then wait, and expect Google to come back asking for something.

### The scope justification, ready to paste

Google warn that vague or duplicated justifications cause delays. One scope now,
so one justification:

> **`googlehealth.activity_and_fitness.readonly`** Ikigaro shows members their
> own daily activity beside their own blood test results, which is the
> comparison the product exists to make. This scope provides the step count,
> active energy and workout sessions displayed on the member's Trends screen,
> and the VO2 max shown alongside their cardiovascular markers. Activity is also
> what distinguishes deliberate training from ambient movement in the training
> and recovery card. The data is read only, shown only to the member it belongs
> to, never sold, never used for advertising, and deleted when the member
> disconnects the device or deletes their account.

### The demonstration video: who can actually record it

**This does not need a Fitbit**, which is the thing that has been quietly
blocking it.

The Google Health API reads a **Google account's** health data, which Fitbit
writes into but so do Pixel Watch, Wear OS devices, and an Android phone
counting steps on its own. Anyone with an Android phone that has been recording
steps has activity data to demonstrate against. Our provider is called "Fitbit"
for historical reasons; what it actually integrates is Google Health.

To record it: add the Google account as a test user on the Audience page, take
the `unavailable` flag off locally, connect, and record the consent screen, then
Trends with the steps visible, then Disconnect. Seven-day tokens are irrelevant
over a five-minute recording.

### One thing to fix before submitting

**The app says "Fitbit" while asking for Google scopes.** The member clicks a
button labelled Fitbit, is sent to a Google consent screen, and grants
`googlehealth.*`. That is accurate history and confusing presentation, and a
reviewer checking that the in-app disclosure matches what the app does may read
it as misleading. Worth renaming the surface to name Google Health, or at least
saying "Fitbit, through your Google account" wherever the button appears. The
provider id can stay `fitbit`; this is a copy change, not a migration.

## The five-minute check nobody has done

**Added 2026-08-19.** This page has always said "most scopes for the Google
Health API are restricted", quoting Google. It has never established whether
**ours** are, and that word "most" is carrying the entire cost estimate.

The distinction is not academic:

| | Sensitive scope | Restricted scope |
|---|---|---|
| Verification | **3 to 5 business days** | **4 to 6 weeks** |
| Privacy policy review | Standard | Rigorous, against Limited Use |
| Security assessment | **None** | **Annual CASA, paid, if you store the data on a server** |
| Cash cost | **Nothing** | ~$500 to $4,500 a year |

**Google Cloud Console tells you which, for free, without asking anybody.**
From Google's OAuth App Verification Help Centre: *"When you add scopes to your
project, scope categories (non-sensitive, sensitive, or restricted) are
indicated automatically in the Google Cloud Console."* Open the project's OAuth
consent screen, go to Scopes, press Add scope, and search for
`googlehealth`. The console labels each one.

**Do this before assuming the cost.** It is the only unknown standing between
"Fitbit is a few thousand a year" and "Fitbit is a free five-day review", and
it costs one login.

Three outcomes, and each points somewhere different:

- **All three restricted.** The decision below stands unchanged, with a real
  number behind it instead of an inference.
- **Some restricted, some sensitive.** A reduced-scope Fitbit becomes possible:
  free verification, days rather than weeks, no annual fee. Whether it is worth
  shipping depends on which survives. Activity alone gives steps and loses
  sleep and HRV, which is most of what this product wants Fitbit for, so this
  would be a coverage decision rather than an obvious win.
- **None restricted.** Publish, and delete the `unavailable` line.

**And confirm the CASA trigger while you are there.** Google are explicit that
the assessment applies *"if you store or transmit restricted scope data on
servers"*. We do, on Supabase, so restricted scopes mean CASA for us with no
exemption to argue for. That is worth knowing is settled rather than hoped.

## What to check before starting

- [x] Is `FITBIT_CLIENT_ID` / `FITBIT_CLIENT_SECRET` set in production? **Yes**,
      confirmed 2026-08-17 from a screenshot of the live connect list. That is
      why hiding it was worth doing rather than noting.
- [x] Does any current tester actually own a Fitbit? **No.** So this page waits,
      and it costs nothing to let it.
- [ ] When you do start: budget the assessment annually, not once. The Letter of
      Validation expires a year after approval and lapsing takes the app back to
      unverified.
