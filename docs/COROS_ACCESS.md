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

**Questions 13 and 14 deserve a decision rather than a default.** They ask for a
webhook endpoint so COROS can push workout summaries, and section 5.3 of their
reference guide describes it. We have no such endpoint for COROS today, and
answering with a URL that 404s is worse than answering N/A. Two honest options:

- **N/A now**, poll like every other provider, and add the endpoint later. Safe,
  and it is what the answers above assume.
- **Build it first** if their reference guide turns out to make push the only way
  to get workouts. Garmin already forced that shape on our sync code, so the
  pattern exists (`/api/wearables/garmin-push`) and the COROS equivalent would be
  a short piece of work.

Read section 5.3 before answering, since it decides which of those is true.

### The email, ready to send

Three placeholders in square brackets need filling before this goes out: the
company registration details, the sender's name and title, and the website if
`ikigaro.com` differs from the app. Everything else is checked against the code.

> **Subject:** API access application: Ikigaro (Avisa Innovation LLP)
>
> Hello,
>
> I am writing to apply for COROS API access on behalf of Ikigaro, a consumer
> wellness application operated by Avisa Innovation LLP.
>
> **About us.** Ikigaro helps people understand their own blood work and see
> what moves it. A member uploads a lab panel, logs a short daily check-in, and
> optionally connects a wearable; we show the three side by side, so what
> somebody did shows up next to what their body recorded and what their next
> panel says. We are in closed beta with single-digit members, ahead of a public
> launch in Q4 2026. Several of our members train seriously enough to own a
> COROS watch, and today we have nothing to offer them.
>
> **What we would read.** Daily summaries only, and only for members who
> explicitly connect their account: sleep and its stages, resting heart rate,
> heart rate variability, blood oxygen, VO2 max, daily steps and energy, and
> workout sessions with their duration, heart rate, distance and energy. We have
> no use for second-by-second streams or GPS tracks and would not request them.
>
> **What happens to it.** It is shown back to the member alongside their own lab
> results, and nowhere else. It is never sold, never used for advertising, never
> shared with another member or a partner, and it earns nothing in our rewards
> programme. Our privacy policy covers connected devices specifically, including
> what disconnecting does: https://app.ikigaro.com/privacy
>
> **Technical details for registration.**
>
> - Company: Avisa Innovation LLP, Pune, Maharashtra, India. [Registration
>   number and registered address.]
> - Technical contact: hello@ikigaro.com
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
> We already run the same integration pattern against WHOOP, Oura and Withings,
> so the work on our side is small once we have credentials and your API
> reference.
>
> **Three questions**, so we build against your intent rather than around it:
>
> 1. Does the API deliver data by webhook when a watch syncs, or is it polled?
>    We support both patterns today and would rather match yours from the start.
> 2. Are the rate limits per application or per member? We pace our requests
>    against published rate-limit headers where a vendor provides them, and the
>    per-application case is the one worth designing for early.
> 3. Where can we read the API reference, and is there anything else you need
>    from us to complete the security and operational review?
>
> I am happy to provide anything further, including a walkthrough of how device
> data appears in the product.
>
> Best regards,
>
> [Name]
> [Title], Avisa Innovation LLP
> [email] | https://app.ikigaro.com

### Why those three questions and not others

1. **Webhook or polling?** Terra's COROS integration describes COROS notifying
   them when new data is ready, so a push model probably exists. Garmin's
   push-only design already forced a shape on our sync code, and knowing which
   we are building for saves a rewrite rather than a preference.
2. **Rate limits per app or per member?** WHOOP's are per app, which is the
   difference between a comfortable budget and a hard ceiling at scale. We have
   pacing built for exactly that now (`rate-limit.ts`), so the answer decides
   whether it applies here.
3. **Where is the API reference?** The blocking one. Everything else waits on it.

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
