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
and complete their application form (linked from the support article above).

**What they ask for**, in their order:

| They want | Ours |
|---|---|
| Company details | Ikigaro, operated by Avisa Innovation LLP, Pune, Maharashtra, India |
| Technical contact | `hello@ikigaro.com` |
| OAuth 2.0 redirect URI | `https://app.ikigaro.com/api/wearables/callback/coros` |
| Acceptance of their standard API Terms of Use | Read them before agreeing, particularly the security requirements and the rate limits |

**The redirect URI is a commitment, so get it right first time.** Every other
integration here follows `/api/wearables/callback/<provider id>`, and the
provider id for this one is `coros`. Registering anything else means either a
special case in `urls.ts` or a second application.

### What to say we want, if they ask

> Ikigaro is a consumer wellness app that puts a member's lab panels beside
> their daily habits and what their device recorded. We read daily summaries
> only: sleep and its stages, resting heart rate, heart rate variability, blood
> oxygen, VO2 max, steps and workout sessions. The data is shown back to the
> member alongside their own blood work, is never sold, never used for
> advertising, and never shown to anyone else. We are in closed beta ahead of a
> Q4 2026 launch.

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
