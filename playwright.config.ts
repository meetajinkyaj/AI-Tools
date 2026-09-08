import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * The same suite runs against three targets, chosen by env var:
 *
 *   npm run e2e                      → a local production build (auto-started)
 *   E2E_TARGET=staging npm run e2e   → the deployed staging app (what CI does)
 *   E2E_TARGET=production npm run e2e → smoke-check the live app (read-only)
 *
 * Every test is READ-ONLY: no signup, no writes, nothing that mutates data.
 * That is what makes it safe to point at production, and it is a constraint to
 * keep, see docs/TESTING.md before adding a test that writes anything.
 */

const TARGETS = {
  local: { url: "http://localhost:3000", expectBadge: false },
  staging: {
    url: "https://ai-tools-staging.meetajinkyaj.workers.dev",
    expectBadge: true,
  },
  production: { url: "https://app.ikigaro.com", expectBadge: false },
} as const;

export type TargetName = keyof typeof TARGETS;

const targetName = (process.env.E2E_TARGET ?? "local") as TargetName;
const target = TARGETS[targetName];
if (!target) {
  throw new Error(
    `Unknown E2E_TARGET "${targetName}". Expected: ${Object.keys(TARGETS).join(", ")}`,
  );
}

/** Exported so specs can assert environment-specific expectations. */
export const E2E_TARGET = targetName;
export const EXPECT_STAGING_BADGE = target.expectBadge;

const baseURL = process.env.E2E_BASE_URL || target.url;
const isLocal = targetName === "local";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  /*
   * TWO RETRIES AGAINST A DEPLOYED TARGET, ONE LOCALLY.
   *
   * These runs cross the public internet from a GitHub runner to Cloudflare,
   * and occasionally a connection is simply reset or aborted mid-navigation.
   * On 2026-09-08 that produced a full red alert on the production smoke
   * suite: 94 assertions passed, and the two that failed did so on one of the
   * two parallel workers with `net::ERR_ABORTED; maybe frame was detached?`,
   * against an app that was serving 200s and 404s correctly the whole time.
   * Seven consecutive runs on the same commit had passed before it.
   *
   * ONE RETRY WAS NOT ENOUGH because the flake outlives a single immediate
   * re-attempt: the first try and the retry land inside the same bad few
   * seconds. A second retry costs nothing when everything is healthy, and the
   * suite runs every thirty minutes, so a genuine outage is still caught on
   * the next sweep even in the worst case.
   *
   * THIS DOES NOT HIDE A REAL FAILURE. A broken deploy fails all three
   * attempts, on both browser projects, every half hour. What it suppresses is
   * exactly one shape of noise, and that shape matters: a smoke alert nobody
   * trusts is worse than no smoke alert, because this suite exists to catch a
   * production outage that no other check would see.
   */
  retries: process.env.CI ? (isLocal ? 1 : 2) : 0,
  workers: process.env.CI ? 2 : undefined,
  // `github` annotates the failing line in the PR diff; `html` is what the
  // workflow uploads as an artifact (with traces) when something fails.
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Lets this run in sandboxes that ship their own Chromium.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
    // Escape hatch for restricted networks (agent sandboxes, corporate
    // proxies) where the browser cannot reach the internet directly, without
    // it, the app loads but Privy never initializes and every UI test fails on
    // a splash screen. Unset in CI, which has direct egress.
    ...(process.env.PLAYWRIGHT_PROXY
      ? {
          proxy: { server: process.env.PLAYWRIGHT_PROXY },
          ignoreHTTPSErrors: true, // the proxy terminates TLS with its own CA
        }
      : {}),
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The app is phone-first, most testers will only ever see this viewport.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  // Only manage a server when testing locally; deployed targets are already up.
  webServer: isLocal
    ? {
        command: "npm run start",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
