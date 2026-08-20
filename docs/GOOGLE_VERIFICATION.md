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

## Answered 2026-08-19: all three scopes are restricted. There is no free path.

**Checked in Google Cloud Console, which is where this should have been checked
first.** The Data Access page files all three under **"Your restricted
scopes"**, with the non-sensitive and sensitive sections both empty:

| Scope | Class |
|---|---|
| `googlehealth.activity_and_fitness.readonly` | **Restricted** |
| `googlehealth.health_metrics_and_measurements.readonly` | **Restricted** |
| `googlehealth.sleep.readonly` | **Restricted** |

**So publishing this client requires the annual paid CASA assessment at any
scope combination.** There is no subset that reaches the free, three-to-five-day
sensitive tier. That question is now closed; do not reopen it by trying a
different reduction.

### The reduction was a bet, and it lost

Earlier the same day the app was cut to `activity_and_fitness.readonly` alone,
on the reasoning that activity was the likeliest scope to be merely sensitive:
step counts and workouts, the descendant of Google Fit's old
`fitness.activity.read`, rather than the clinical-shaped data in the other two.
That reasoning was explicitly flagged as a judgement rather than a fact, and it
was wrong.

**It has been reverted to all three.** One restricted scope and three cost the
same assessment, so keeping the reduction would have meant paying full price for
a third of the data, losing sleep and the entire heart-rate family, which is
most of what this product wants from a wearable.

**What the episode left behind is worth keeping.** The adapter now derives what
to fetch from the scopes actually granted, so a member who declines a scope at
Google's consent screen no longer causes a guaranteed 403 per collection per
night. That was always a bug; the reduction only made it visible.

### The decision this forces

**Google Health costs $500 to $4,500 a year, every year, or it stays hidden.**
It is the only integration on the roadmap with a recurring cash cost: Withings,
Polar and COROS are self-serve and free, and WHOOP has a review but no fee.

At single-digit testers, none of whom owns a Fitbit or a Pixel Watch, that is
clearly not worth paying.

**DECIDED 2026-08-19: Google Health stays hidden. Not before launch.** This is
the founder's call and not a pending question, so it does not need re-opening
every time somebody notices the adapter sitting there. Revisit when a real
member is blocked by its absence, or when the annual fee is small next to what
the app earns. Until then the adapter is complete, audited, hidden, and costs
nothing to keep.

### The free half, done and not done

Completed 2026-08-19 and banked, since none of it expires:

- **OAuth consent screen filled in**: app name, support and developer emails,
  authorised domain `ikigaro.com`, home page `https://ikigaro.com`, privacy
  policy `https://app.ikigaro.com/privacy`, terms `https://app.ikigaro.com/terms`.

Still outstanding, and each is cheap when the time comes:

- **The app logo** on the consent screen. Needs a file nobody has supplied.
- **Domain verification for `ikigaro.com`** in Search Console. The property
  exists under the right account but sits unverified, and finishing it needs a
  **DNS TXT record**. Approved 2026-08-19 and being done, because it never
  expires and is a prerequisite under every future version of this decision.

  **The hazard, if you are the one doing it:** `ikigaro.com` already carries
  three TXT records for Resend (SPF, DKIM and DMARC) plus an MX, per
  `EMAIL.md`. Google's verification record is a SEPARATE, ADDITIONAL TXT record
  at the apex. It must never be merged into, or written over, the existing SPF
  record: a domain may hold only one SPF record, so anybody "tidying" the apex
  TXT entries into one breaks outgoing member email, and nothing in this app
  will report that.
- **`ikigaro.com` does not link to a privacy policy anywhere.** Google's
  reviewers expect the registered homepage to link one, so this is a real
  blocker for any future submission. Note that the marketing site is a
  **separate codebase**: this repo serves `app.ikigaro.com`, whose own landing
  page does link both privacy and terms.
- **The business name is inconsistent** across surfaces: the site says
  "Ikigaro", "IKIGARO OS" and "Ikigaro Club", the Cloud project says "Ikigaro",
  and the legal entity is Avisa Innovation LLP. Worth aligning before a
  reviewer compares them.

Not started, and correctly so: the scope justification and the demonstration
video, both of which only matter at submission.

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

### The copy now says Google Health, done 2026-08-19

The app used to say "Fitbit" while sending members to a Google consent screen
asking for `googlehealth.*` scopes. That is accurate history and misleading
presentation, and a reviewer checking that the in-app disclosure matches what
the app does could fairly have called it out.

Renamed on every surface a member or a reviewer sees: the connect button, the
chart legend, the admin device list and the privacy policy. **The provider id
stays `fitbit`**, because it is in redirect URIs, stored rows and env var
names, and renaming that is a migration for no benefit.

It also fixed something the old name was hiding. This reads a **Google
account's** health data, which a Pixel Watch, a Wear OS watch or an Android
phone counting steps all write to. Calling it Fitbit told every one of those
members we did not support them. Their device names are now aliases on the
request matcher.

**Watch the two Googles.** Google Health (the cloud API we integrate) and
Google Health Connect (the on-device Android API, which needs a native app we
do not have) are different products with near identical names.
`device-requests.ts` keeps them apart, and the bare phrase "google health" now
routes to the one we can actually deliver.

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
