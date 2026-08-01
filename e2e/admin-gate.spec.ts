import { expect, test } from "@playwright/test";

import { E2E_TARGET } from "../playwright.config";
import { gotoApp } from "./helpers";

/**
 * The admin console's front door.
 *
 * Two independent protections, tested separately:
 *   1. Authorization, `requireAdmin` (ADMIN_EMAILS, fail-closed) gates every
 *      admin API server-side. That is what actually protects data, and
 *      `api-auth.spec.ts` asserts all nine admin routes return 403.
 *   2. The host split, production sends /admin to the Cloudflare Access-gated
 *      subdomain, so the console isn't served on the public app host.
 *
 * On production the console sits behind Access, which the test runner has no
 * credentials for. So the UI tests run where /admin is served directly (staging
 * and local), and production gets the redirect assertion instead.
 */
test.describe("admin console UI", () => {
  test.skip(
    E2E_TARGET === "production",
    "production serves /admin only on the Access-gated host",
  );

  test("shows a sign-in wall to anonymous visitors", async ({ page }) => {
    await gotoApp(page, "/admin");

    await expect(page.getByText(/admin access is restricted/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();

    // None of the console's real surfaces may be reachable here.
    await expect(page.getByRole("button", { name: /^approve$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /revoke/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /add item/i })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /analytics/i })).toHaveCount(0);
  });

  test("leaks no user data before authentication", async ({ page }) => {
    await gotoApp(page, "/admin");
    await page.waitForTimeout(1500); // give any data fetch time to resolve

    const body = await page.locator("body").innerText();
    expect(body, "an email address rendered on the anonymous admin page").not.toMatch(
      /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
    );
  });

  test("is excluded from search engines", async ({ page }) => {
    // Server-rendered metadata, deliberately does NOT wait for the app to
    // boot, so this still holds if the client bundle is broken.
    await page.goto("/admin");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });
});

test.describe("admin host split", () => {
  test("production /admin returns a real 307 to the gated subdomain", async ({
    request,
  }) => {
    test.skip(E2E_TARGET !== "production", "only app.ikigaro.com redirects");

    // Deliberately does NOT follow the redirect, the point is that an HTTP
    // redirect exists at all. This regressed to a 200 carrying a client-side
    // redirect instruction that only browsers acted on; see next.config.ts.
    const res = await request.get("/admin", {
      maxRedirects: 0,
      failOnStatusCode: false,
    });

    expect(res.status(), "expected an HTTP redirect, not a rendered page").toBe(307);
    expect(res.headers()["location"]).toBe("https://admin.ikigaro.com/admin");
  });
});
