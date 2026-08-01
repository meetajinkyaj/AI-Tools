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
  // Deployed targets go over the public internet; one retry absorbs a flaky
  // connection without hiding a real, reproducible failure.
  retries: process.env.CI ? 1 : 0,
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
