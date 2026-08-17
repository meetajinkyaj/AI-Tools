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

### Two things to ask them, since the answers shape the adapter

1. **Is there a webhook, or is it polling?** Terra's integration describes COROS
   notifying them when new data is ready, which suggests a push model exists.
   Garmin's push-only design already forced a shape on our sync code, so knowing
   this before writing anything saves a rewrite.
2. **What are the rate limits, and are they per app or per member?** WHOOP's are
   per app, which is the difference between a comfortable budget and a hard
   ceiling at scale, and we now have pacing built for exactly that
   (`rate-limit.ts`).

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
