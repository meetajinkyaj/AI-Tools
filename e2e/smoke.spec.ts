import { expect, test } from "@playwright/test";

import { gotoApp } from "./helpers";

/**
 * The signed-out landing page.
 *
 * This is the single highest-value test in the suite. Every catastrophic
 * failure this project has actually shipped rendered a blank or broken page to
 * every visitor, an empty NEXT_PUBLIC_* at build time, a Privy provider that
 * threw on load, a black first frame on dark-mode phones. All of them would
 * have failed here before a human noticed.
 */
test.describe("landing page", () => {
  test("renders the signed-out hero with both entry points", async ({ page }) => {
    const response = await gotoApp(page);
    expect(response?.status(), "landing must return 200").toBe(200);

    // The wordmark proves React mounted and the brand fonts/CSS resolved.
    await expect(page.getByText("kigaro").first()).toBeVisible();
    await expect(
      page.getByText("Performance · Recovery · Longevity"),
    ).toBeVisible();

    // New and returning users each need their own door (see landing.tsx).
    await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByText(/no password needed/i)).toBeVisible();
  });

  test("is not a blank page", async ({ page }) => {
    // A white-screen crash still returns 200 with a near-empty body, so assert
    // on rendered text rather than status. gotoApp throws a diagnostic if the
    // app never boots.
    await gotoApp(page);
    const text = await page.locator("body").innerText();
    expect(text.trim().length, "body should contain rendered copy").toBeGreaterThan(40);
  });

  test("links to the legal pages", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByRole("link", { name: /privacy/i })).toHaveAttribute(
      "href",
      "/privacy",
    );
    await expect(page.getByRole("link", { name: /terms/i })).toHaveAttribute(
      "href",
      "/terms",
    );
  });

  test("loads without client-side errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await gotoApp(page);
    await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
    await page.waitForTimeout(1500); // let deferred work (SW, Privy init) settle

    // Third-party analytics/auth noise is not ours to fix; anything else is.
    const ours = errors.filter(
      (e) => !/privy|analytics|favicon|third-party cookie/i.test(e),
    );
    expect(ours, `unexpected client errors:\n${ours.join("\n")}`).toEqual([]);
  });

  test("unknown routes render a 404, not a crash", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);
    const text = await page.locator("body").innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });
});
