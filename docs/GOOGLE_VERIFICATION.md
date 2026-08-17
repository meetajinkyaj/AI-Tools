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

## What to check before starting

- [x] Is `FITBIT_CLIENT_ID` / `FITBIT_CLIENT_SECRET` set in production? **Yes**,
      confirmed 2026-08-17 from a screenshot of the live connect list. That is
      why hiding it was worth doing rather than noting.
- [x] Does any current tester actually own a Fitbit? **No.** So this page waits,
      and it costs nothing to let it.
- [ ] When you do start: budget the assessment annually, not once. The Letter of
      Validation expires a year after approval and lapsing takes the app back to
      unverified.
