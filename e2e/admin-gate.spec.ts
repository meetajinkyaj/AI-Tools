import { expect, test } from "@playwright/test";

import { E2E_TARGET } from "../playwright.config";
import { gotoApp } from "./helpers";

/**
 * The admin console's front door.
 *
 * Two separate things are being checked: that an anonymous visitor is shown a
 * sign-in wall rather than any data, and that the page never renders admin
 * content while unauthenticated. `ADMIN_EMAILS` is fail-closed in code, but a
 * UI that painted the console first and checked later would leak on-screen.
 */
test.describe("admin console", () => {
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
    await page.goto("/admin");
    await page.waitForTimeout(1500); // give any data fetch time to resolve

    const body = await page.locator("body").innerText();
    expect(body, "an email address rendered on the anonymous admin page").not.toMatch(
      /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
    );
  });

  test("is excluded from search engines", async ({ page }) => {
    await page.goto("/admin");
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/);
  });

  // Production sends /admin to the gated subdomain; staging and local serve it
  // directly, which is what makes a fresh environment bootstrappable at all.
  test("production redirects /admin to the gated subdomain", async ({ page }) => {
    test.skip(E2E_TARGET !== "production", "redirect only fires on app.ikigaro.com");
    await page.goto("/admin");
    expect(page.url()).toContain("admin.ikigaro.com");
  });
});
