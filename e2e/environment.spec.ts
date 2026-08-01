import { expect, test } from "@playwright/test";

import { E2E_TARGET, EXPECT_STAGING_BADGE } from "../playwright.config";
import { gotoApp } from "./helpers";

/**
 * Confirms the suite is pointed where it thinks it is.
 *
 * Without this, a misconfigured `E2E_BASE_URL` would run the whole suite
 * against the wrong deployment and report green, the tests would pass, and
 * they would be telling you nothing about the code under review.
 */
test.describe("deployment identity", () => {
  test(`target "${E2E_TARGET}" shows the correct environment badge`, async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByText("kigaro").first()).toBeVisible();

    const badge = page.getByText(/not live data/i);

    if (EXPECT_STAGING_BADGE) {
      await expect(
        badge,
        "staging must be visibly marked, or a tester cannot tell it from production",
      ).toBeVisible();
    } else {
      await expect(
        badge,
        "production must NOT show the staging badge",
      ).toHaveCount(0);
    }
  });

  test("the production hostname never advertises itself as staging", async ({
    page,
  }) => {
    await page.goto("/");
    const host = new URL(page.url()).hostname;
    const hasBadge = (await page.getByText(/not live data/i).count()) > 0;

    if (host === "app.ikigaro.com") {
      expect(hasBadge, "app.ikigaro.com is production").toBe(false);
    }
  });
});
