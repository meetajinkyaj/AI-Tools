# Getting COROS API access

Everything needed to apply, and an explanation of why there is no adapter yet.

Source: `support.coros.com`, "Submit an API Application", read 2026-08-17.

---

## The finding: this is no longer a partnership, it is an onboarding

Our notes had COROS filed with Garmin and Ultrahuman as "partner application,
their approval", meaning a queue and somebody's judgement. Their own page now
says otherwise, and the change is worth knowing:

> "We manage third-party API access through a **standardized, objective
> developer onboarding process**. Rather than building custom integrations or
> conducting manual selection reviews, we grant access through our standard
> OAuth 2.0 API framework to **any platform that satisfies our standard security
> and operational requirements**."

They attribute this to EU data protection law, naming GDPR and the EU Data Act.
That matters more than the wording: a vendor granting access because regulation
obliges them to is a vendor whose answer does not depend on how interesting they
find us. No fee is mentioned anywhere, which puts COROS closer to Polar than to
Google.

**No plan should still assume a long wait.** Whether verification takes days or
weeks is unknown, but "objective" and "non-discriminatory" are their words, and
the failure mode we planned around (being quietly declined for being small) is
not the one described.

## Why there is no adapter yet, and why that is the right order

**The API reference is not public.** Credentials are issued after identity and
security verification, and the endpoint documentation comes with them. So a
COROS adapter written today would be written from guesswork, which is the exact
mistake this codebase has already paid for once: the Ultrahuman adapter was
built from assumption rather than documentation and was wrong in almost every
particular, silently.

The Google Health work went code-first because the scope list had to match the
code. COROS is the opposite: apply first, read their documentation, then write
an adapter against it.

### The shortcut that is not one

Search "coros api" and the first results are community projects that drive
`apieu.coros.com` and the Training Hub web endpoints. Those are the **mobile and
web apps' private APIs**, and they authenticate with the member's own COROS
**email and password**. Two independent reasons that is not an option here:

1. It would mean asking members to hand this app their COROS password, and
   storing it. Nothing about that survives a moment's thought in a health
   product, and it is a category of credential we have deliberately never held.
2. One such project's own README warns it "could break anytime", and an
   undocumented endpoint underneath somebody's health record is both a
   data-integrity risk and an unstated dependency on a vendor's goodwill.

Noting it here because a future reader searching for the API will find those
repositories first, and they look like an answer.

---

## The application

**Route.** Email `api@coros.com` from an authorised technical representative,
and complete their application form.

**The form:** https://coros-teams.feishu.cn/share/base/form/shrcnLqSduZsaNhbvDJTO2x0Vlf
(a Feishu form, linked from their support articles behind the words "this
link"). Email `api@coros.com` as well: their process names both.

**Two conditions stated in the form's own introduction**, before any question:

> "We require that all partners add a **Login Portal and Support Page** to their
> website or support center to allow users to access the integration and request
> technical support. **There is no fee** associated with integration when
> partnering with COROS."

The login portal is `app.ikigaro.com`. The support page did not exist and now
does: `/support`, linked from the landing page, the legal pages and Profile.

**The API Reference Guide is linked from the form's introduction**, which means
the documentation arrives BEFORE credentials rather than with them. That
reverses the order this page originally recommended: fetch that guide, and the
adapter can be written properly while the application is still being reviewed.

## The 24 answers

| # | Question | Answer |
|---|---|---|
| 1 | Platform / Application Name | Ikigaro |
| 2 | Company Name | Avisa Innovation LLP |
| 3 | Primary Contact Email | hello@ikigaro.com |
| 4 | Secondary Contact Email | [second address, or repeat the primary] |
| 5 | Privacy Officer Email | hello@ikigaro.com (or a dedicated address if one exists) |
| 6 | Company Owner Name and Title | [name and title] |
| 7 | Platform / Application URL | https://app.ikigaro.com |
| 8 | Description (100 characters) | `Your blood work, daily habits and watch data, read side by side.` (64) |
| 9 | Total Active Users | 0-150 |
| 10 | Primary Region | India |
| 11 | API functions needed | **Activity / Workout Data Sync (one way, COROS to your platform)** and **Access Daily Health Data**. Nothing else. |
| 12 | Authorized Callback Domain | https://app.ikigaro.com |
| 13 | Workout data receiving endpoint | N/A for now, see below |
| 14 | Service status check URL | N/A for now, see below |
| 15 | Bluetooth / ANT+ profile | N/A |
| 16 | Personal or public use | Public |
| 17 | Commercial or non-commercial | Commercial |
| 18 | Intended use of data | See the paragraph below |
| 19 | Expected Integration Launch Date | Q4 2026 |
| 20 | Agree to the API Application Terms | Yes, after reading them |
| 21 | Agree to the COROS API Agreement | Yes, after reading it |
| 22 | Your name | [name] |
| 23 | Submit date | The day it is sent |
| 24 | Logo PNGs (144x144 and 102x102 required) | Generated from `public/icon-512.png`; 120x120 and 300x300 too, which are required only for workout or training-plan sync |

**Question 18, intended use of data:**

> Ikigaro helps people understand their own blood work and see what moves it. A
> member uploads a lab panel, logs a short daily check-in, and optionally
> connects a wearable; we show the three side by side. COROS data would be read
> only for members who explicitly connect their account, and only as daily
> summaries: sleep and its stages, resting heart rate, heart rate variability,
> blood oxygen, VO2 max, daily steps and energy, and workout sessions with their
> duration, heart rate, distance and energy. It is shown back to that member
> alongside their own lab results and nowhere else. It is never sold, never used
> for advertising, never shared with another member or partner, and it earns
> nothing in our rewards programme. Tokens are encrypted at rest, held server
> side only, and deleted when a member disconnects. Privacy policy:
> https://app.ikigaro.com/privacy

**Questions 13 and 14: N/A, and the reference guide settles it.**

The question was whether push is the only way to get workouts. It is not.
Section 4.2 polls them:

> `GET https://open.coros.com/v2/coros/sport/list?token=...&openId=...&startDate=20170101&endDate=20170110`
>
> "The maximum date range for one query is 30 days, and the query date is not
> earlier than three months before the day."

Section 4.3 polls daily data the same way. Section 5 opens with "**If you need**
the Workout Summary Data Push Service", and the form repeats that condition, so
push is an option rather than the route. Polling is what every other provider
here does, our nightly sweep already runs it, and a daily summary does not
benefit from arriving five minutes sooner.

So both answers are **N/A**, and that costs nothing. What it does cost is
history: polling reaches three months back and no further, where WHOOP gave us
sixty days by choice rather than by limit. Worth knowing before somebody expects
a year of a member's training on their first sync.

**If push is wanted later**, section 5.2 and 5.3 describe a straightforward
endpoint and nothing in it needs a re-application, only new URLs sent to COROS:

- COROS POST workout summaries to an HTTPS endpoint of ours, with `client` and
  `secret` in the **request header**, which we verify before accepting anything.
  `safeEqual` in `src/lib/reminders.ts` is the constant-time comparison to use.
- They check newly added and previously failed workouts **every 5 minutes**,
  retry a failed push **twice**, and stop retrying after **24 hours**.
- **Duplicates are expected**: "COROS may push the same workout data again if
  push timeout occurs since COROS can't verify if partner has received the
  data." Our workout upsert is keyed on (user, provider, external id), so this
  is already handled.
- The "Service Status Check API" in question 14 is simply a URL they GET and
  expect **HTTP 200** from. We have no such endpoint today; it would be a few
  lines.

## What the API reference says, for when the adapter is written

From `COROS_API_Reference_V2.0.6` (February 2026), read 2026-08-18. Recorded
here so the adapter is written against the document rather than against memory
of it.

- **Base URL** `https://open.coros.com`. Regional URLs were consolidated into
  this one in May 2026 per their changelog.
- **OAuth**: `GET /oauth2/authorize?client_id=...&redirect_uri=...&state=...&response_type=code`.
  The code is single use and expires in 30 minutes. The **access token is valid
  for 30 days** and is refreshable, which is far longer than every other vendor
  here and changes what "expired" means for a COROS connection.
- **All calls use `application/x-www-form-urlencoded`.**
- **Workouts**: `GET /v2/coros/sport/list`, 30 days per query, three months of
  history maximum.
- **Daily data**: section 4.3, same date-range shape.
- **Identity**: `openId`, COROS's own user identifier, which maps onto
  `wearable_connections.external_user_id`.
- **Rate limit: 1,000 calls a minute**, raisable on request. Ten times WHOOP's,
  and our pacing already reads whatever headers a vendor sends.
- **Units to normalise carefully**: distance in metres, `avgSpeed` in
  seconds per kilometre, `avgFrequency` in steps per minute, timestamps in epoch
  seconds, and timezones as a count of 15-minute steps where 32 means UTC+08:00.
  `calorie` is documented as "Unit: calorie", which for a workout almost
  certainly means kilocalories; **verify against a real session before trusting
  it**, because this is exactly the shape of the WHOOP kilojoule trap.

### The email, ready to send

**Send it after `/support` is deployed**, not before. The form's introduction
requires a support page, this email links to it, and a reviewer clicking a 404
is a worse first impression than waiting a day.

Three placeholders in square brackets: the company registration details, the
sender's name and title, and a secondary contact. Everything else is checked
against the code or against their own reference guide.

> **Subject:** API access application: Ikigaro (Avisa Innovation LLP)
>
> Hello,
>
> I am writing to apply for COROS API access on behalf of Ikigaro, a consumer
> wellness application operated by Avisa Innovation LLP. I have submitted the
> application form and am following up here as your onboarding process asks.
>
> **About us.** Ikigaro helps people understand their own blood work and see
> what moves it. A member uploads a lab panel, logs a short daily check-in, and
> optionally connects a wearable; we show the three side by side, so what
> somebody did shows up next to what their body recorded and what their next
> panel says. We are in closed beta with single-digit members, ahead of a public
> launch in Q4 2026. Several of our members train seriously enough to own a
> COROS watch, and today we have nothing to offer them.
>
> **What we would read**, and only for members who explicitly connect their
> account: daily data (section 4.3) and workout records (section 4.2). In our
> terms that is sleep and its stages, resting heart rate, heart rate
> variability, blood oxygen, VO2 max, daily steps and energy, and workout
> sessions with their duration, heart rate, distance and energy. We have no use
> for second-by-second streams or GPS tracks and would not request them.
>
> **What happens to it.** It is shown back to the member alongside their own lab
> results, and nowhere else. It is never sold, never used for advertising, never
> shared with another member or a partner, and it earns nothing in our rewards
> programme. Our privacy policy covers connected devices specifically, including
> what disconnecting does: https://app.ikigaro.com/privacy
>
> **Your two partner requirements are in place.** Login portal:
> https://app.ikigaro.com. Support page: https://app.ikigaro.com/support, which
> covers connecting and disconnecting a device, what to do when a reading looks
> wrong or nothing has arrived, and how to reach us.
>
> **Technical details for registration.**
>
> - Company: Avisa Innovation LLP, Pune, Maharashtra, India. [Registration
>   number and registered address.]
> - Technical contact: hello@ikigaro.com. [Secondary contact.]
> - Application: https://app.ikigaro.com
> - OAuth 2.0 redirect URI: https://app.ikigaro.com/api/wearables/callback/coros
> - Authorisation flow: OAuth 2.0 authorization code, server side. Client
>   secrets and member tokens are held only on our servers, encrypted at rest,
>   and are never exposed to a browser or a mobile client.
> - Hosting: Cloudflare Workers, with Postgres on Supabase. Every table has
>   row-level security enabled and application data is reachable only through
>   our server.
> - On disconnect we call the provider's revocation endpoint where one exists,
>   delete our copy of the credentials immediately, and stop all reading. Members
>   can have their stored data erased on request.
>
> **On the workout data push service**, we answered N/A to both endpoint
> questions on the form deliberately, having read section 5. We will poll
> sections 4.2 and 4.3 on a daily schedule, which is how our five existing
> integrations work, and a daily summary does not benefit from arriving sooner.
> If you would rather partners receive pushes, say so and we will build the
> receiving and status endpoints before we go live.
>
> We already run this integration pattern against WHOOP, Oura and Withings, so
> the work on our side is short now that we have your V2.0.6 reference guide.
>
> **Two questions.**
>
> 1. Is the documented cap of 1,000 calls a minute per application or per
>    member? We pace requests against published rate-limit headers where a
>    vendor sends them, and the per-application case is the one worth designing
>    for early.
> 2. Is there anything further you need from us to complete the security and
>    operational review?
>
> Best regards,
>
> [Name]
> [Title], Avisa Innovation LLP
> hello@ikigaro.com | https://app.ikigaro.com

### Why the questions shrank

An earlier draft asked three. Reading V2.0.6 answered two of them, and asking a
vendor something their own documentation states is a way of telling them you did
not read it.

- **Webhook or polling?** Answered. Section 4.2 and 4.3 poll; section 5's push is
  explicitly optional. The email now states which we chose and why, rather than
  asking.
- **Where is the API reference?** Answered: it is linked from the application
  form itself.
- **Rate limits per app or per member?** Still open. The guide gives the number,
  1,000 calls a minute, but not whose. That distinction is the difference
  between a comfortable budget and a ceiling, and our pacing already handles the
  per-application case (`rate-limit.ts`).

---

## When the credentials arrive

1. Read their API reference and record the shapes here before writing code, the
   way `WEARABLES.md` records WHOOP's and Oura's.
2. Add `coros` to `ProviderId`, `PROVIDER_NAMES` and the adapter registry.
3. Map their fields onto the existing metric vocabulary rather than inventing
   keys. Sleep stages sum to `sleep_minutes` the way WHOOP's do; their recovery
   or readiness equivalent goes to `readiness_score`; VO2 max, HRV, resting
   heart rate and SpO2 already exist.
4. `COROS_CLIENT_ID` / `COROS_CLIENT_SECRET` as Cloudflare secrets, never in a
   file.
5. Test against the documented payloads, not against invented ones.
