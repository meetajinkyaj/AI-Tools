# Testing

_Last updated: 2026-07-27_

Two suites, deliberately separate.

| | Unit (Vitest) | End-to-end (Playwright) |
|---|---|---|
| Command | `npm test` | `npm run e2e` |
| Lives in | `src/**/*.test.ts` | `e2e/**/*.spec.ts` |
| Tests | pure domain logic | a running deployment in a real browser |
| Needs | nothing | an app to point at |
| Count | 217 | 49 × 2 viewports |
| Runs in CI | every push and PR | every PR against staging, plus every ~30 min against production |

They are kept apart on purpose: Vitest's default patterns would otherwise try
to run the Playwright specs and fail confusingly, so `vitest.config.ts` scopes
Vitest to `src/`.

---

## Unit tests

Fast, no network, no database. They cover the parts where a subtle mistake is
expensive and invisible: biomarker interpretation, the points economy and its
anti-farm guards, streaks, trends, projections, referral milestones, reminder
due-logic, Privy token verification, and the production-database guard.

```bash
npm test              # once
npx vitest            # watch mode
```

### Test files are typechecked too

`tsconfig.json` used to exclude `**/*.test.ts`, so `tsc` never looked at them.
That is a worse gap than it sounds: a test's fixtures are usually typed as the
very interface under test, and when the interface gains a required field the
fixture silently stops satisfying it. The tests keep passing — they exercise
real behaviour against a stale shape — and nothing reports it. Removing the
exclusion immediately surfaced two such defects that had been sitting in the
suite.

The rule that follows: **type your fixtures, and don't reach for `as` to
quiet an error.** A literal like `["low", "high"]` widens to `string[]` and
will accept a value the union no longer contains, which is exactly the drift
this is meant to catch.

## End-to-end tests

```bash
npm run e2e             # against a local production build (auto-started)
npm run e2e:staging     # against the deployed staging app — what PR CI runs
npm run e2e:production  # against the live app — what the smoke monitor runs
npm run e2e:ui          # interactive debugging
```

### The one rule: every E2E test is read-only

No signup, no writes, no data mutation — the suite only loads pages and calls
APIs *expecting to be rejected*. That constraint is what makes it safe to point
at production, and it is why CI can run it on every PR without accumulating
junk in the staging database.

**Before adding a test that writes anything, stop and read "Authenticated
flows" below** — it is not a small change.

### What's covered

| File | What it protects |
|---|---|
| `smoke.spec.ts` | The landing page actually renders. Every catastrophic failure this project has shipped — an empty `NEXT_PUBLIC_*` at build time, a Privy provider throwing on load — showed up as a blank or broken page, and would fail here first. |
| `api-auth.spec.ts` | Every data route rejects anonymous callers (users → 401, admin → 403), malformed tokens don't authenticate, the cron endpoint demands its secret, and no rejection leaks an email. |
| `admin-gate.spec.ts` | `/admin` shows a sign-in wall, renders no user data before auth, and is `noindex`. |
| `environment.spec.ts` | The suite is pointed where it thinks it is — staging shows the badge, production must not. |
| `legal-and-pwa.spec.ts` | `/privacy` and `/terms` render, `#rewards` still exists, the manifest is valid, every icon resolves, the service worker and offline page are served. |

`api-auth.spec.ts` deserves special mention. All database access runs through
the service-role key, which **bypasses Row Level Security** — so these
route-level checks are not one layer of defense, they are the only one. A route
that forgets its auth check is a full data leak with nothing behind it.

### Adding a route? Add it to `api-auth.spec.ts`

`USER_ROUTES` and `ADMIN_ROUTES` are hand-maintained lists. A new endpoint that
isn't added there is simply untested — nothing will remind you.

---

## Authenticated flows are NOT covered (and why)

Nothing behind login is tested automatically: onboarding, panel upload and
confirmation, check-ins, redemption, referrals.

The blocker is real. Login is Privy email-OTP, so a test would have to receive
an email and read a one-time code. The usual shortcuts are all bad here:

- **A test-only login bypass** would be a permanent auth backdoor in an app
  holding health data. Staging shares production's Privy app, so it would not
  even be contained to staging. Not worth it.
- **A test-only signing key** (pointing `PRIVY_VERIFICATION_KEY` at a key pair
  we control on staging) is more contained, but staging would then stop
  exercising the real token-verification path — the suite would pass while the
  thing it is meant to verify goes untested.
- **Reading OTPs from a mailbox** (a catch-all inbox, or a service like
  Mailosaur) is the honest option: it tests the real flow with no production
  code changes. It costs a mail service and some setup.

**Recommendation:** the mailbox approach, when authenticated coverage becomes
worth that setup. Until then these flows are verified by hand on staging before
merging anything that touches them — which is exactly what the staging
environment is for.

---

## Running E2E on a restricted network

The app shows a splash until Privy initializes. If the browser can't reach
Privy — a locked-down network, a sandbox, or an origin missing from Privy's
allowed domains — the app never boots and every UI test fails.

`gotoApp()` detects this and fails with that diagnosis rather than a bare
"element not found", so the cause is visible in the CI log.

Two escape hatches, both env-var opt-in and unused in CI:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium   # use a preinstalled browser
PLAYWRIGHT_PROXY=http://127.0.0.1:8080       # route the browser through a proxy
```

---

## What CI does

```
PR → build (lint, typecheck, unit tests, next build)
   → deploy-staging
   → e2e (Playwright against the deployed staging app)
```

E2E runs *after* the staging deploy, so it tests the code as actually deployed,
not a local approximation. On failure the HTML report — including traces and
screenshots — is uploaded as a workflow artifact for 7 days.

E2E does **not** run on pushes to `main`, because staging is not redeployed
there; the PR run is the gate.

## The production smoke monitor

`.github/workflows/smoke.yml` runs the same suite against **app.ikigaro.com**
roughly every 30 minutes (plus on demand via *Run workflow*).

It exists because **CI only tests staging, so production can break with every
check green**. That is not hypothetical: a Privy allowed-domains edit dropped
`app.ikigaro.com`, every visitor got an endless splash screen, and it went
unnoticed for a day. Nothing in the code was wrong — which is the point. The
app is only healthy if its configuration is healthy too, and configuration is
what nothing else watches.

Its failure summary lists the likeliest causes in order, starting with the
Privy allowed-domains list. GitHub emails the repo owner when a scheduled
workflow fails; a red run means the **live app is broken right now**.

Two behavioural differences on the production target:
- The admin UI tests skip — production serves `/admin` only on the Cloudflare
  Access-gated host, which the runner has no credentials for.
- Instead, one test asserts `app.ikigaro.com/admin` returns a real **307** to
  that host, without following it.
