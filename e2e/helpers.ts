import { expect, type Page } from "@playwright/test";

/**
 * Navigate to a page and wait for the app to finish booting.
 *
 * The app shows a branded splash until Privy initializes, so "stuck on the
 * splash" is a distinct failure from "the page is broken", and it has two very
 * different causes: the app is genuinely down, or the browser cannot reach
 * Privy (a restricted network, a missing allowed-origin, an outage).
 *
 * Playwright's default "element not found" says none of that, so this turns
 * the timeout into a diagnosis. Worth the indirection: this is the failure a
 * non-expert is most likely to hit first.
 */
export async function gotoApp(page: Page, path = "/") {
  const response = await page.goto(path);

  try {
    // Any booted screen has content beyond the splash's wordmark + tagline.
    await expect
      .poll(async () => (await page.locator("body").innerText()).trim().length, {
        timeout: 15_000,
      })
      .toBeGreaterThan(60);
  } catch {
    const text = (await page.locator("body").innerText()).trim();
    const onSplash = /Performance · Recovery · Longevity/.test(text) && text.length < 120;

    throw new Error(
      onSplash
        ? "The app never got past the startup splash.\n" +
          "Most likely the browser could not reach Privy (auth): a restricted " +
          "network, or this origin is missing from Privy's allowed domains.\n" +
          "If Privy is reachable, this is a real startup failure, treat it as " +
          "a white-screen regression.\n" +
          `Rendered text was: ${JSON.stringify(text)}`
        : `The page rendered almost nothing, likely a client-side crash.\n` +
          `Rendered text was: ${JSON.stringify(text)}`,
    );
  }

  return response;
}
