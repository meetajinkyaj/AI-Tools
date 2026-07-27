import { expect, test } from "@playwright/test";

/**
 * Legal pages and PWA plumbing.
 *
 * The legal pages are linked from the app, the marketing site, and the app
 * store-style install flow; they are also the pages counsel reviews. A 404 here
 * is both a compliance problem and an embarrassing one, and because nothing in
 * the daily flow touches them, a break could sit unnoticed for weeks.
 */
test.describe("legal pages", () => {
  for (const [path, heading] of [
    ["/privacy", /privacy policy/i],
    ["/terms", /terms of service/i],
  ] as const) {
    test(`${path} renders`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    });
  }

  test("the rewards clause anchor still exists", async ({ page }) => {
    // partners-view.tsx links users to /terms#rewards; if that id is renamed
    // the link silently lands at the top of a long document.
    await page.goto("/terms");
    await expect(page.locator("#rewards")).toHaveCount(1);
  });

  test("terms carry the fixed medical disclaimer", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByText(/not.*(medical|diagnosis)/i).first()).toBeVisible();
  });
});

test.describe("PWA", () => {
  test("serves a valid manifest", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);

    const manifest = (await res.json()) as {
      name: string;
      display: string;
      start_url: string;
      icons: { src: string }[];
    };
    expect(manifest.name).toBe("Ikigaro");
    // standalone is what makes an installed launch feel like an app rather
    // than a browser tab — losing it is a silent downgrade.
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  test("every manifest icon actually resolves", async ({ request }) => {
    const manifest = (await (await request.get("/manifest.webmanifest")).json()) as {
      icons: { src: string }[];
    };
    for (const icon of manifest.icons) {
      const res = await request.get(icon.src);
      expect(res.status(), `${icon.src} is referenced but missing`).toBe(200);
      expect(res.headers()["content-type"]).toContain("image");
    }
  });

  test("the maskable icon is its own full-bleed file", async ({ request }) => {
    // Android crops maskable icons to its own shape. Pointing this entry at the
    // rounded art double-rounds the corners — a subtle wrong that survives code
    // review because the manifest still validates and the file still loads.
    const manifest = (await (await request.get("/manifest.webmanifest")).json()) as {
      icons: { src: string; purpose?: string }[];
    };
    const maskable = manifest.icons.filter((i) => i.purpose?.includes("maskable"));
    expect(maskable.length, "no maskable icon declared").toBeGreaterThan(0);

    const any = manifest.icons
      .filter((i) => i.purpose === "any")
      .map((i) => i.src);
    for (const icon of maskable) {
      expect(any, `${icon.src} is doing double duty as "any" and "maskable"`).not.toContain(
        icon.src,
      );
    }
  });

  test("the apple touch icon is served", async ({ request }) => {
    // iOS reads this from the <link> tag, not the manifest, so nothing else in
    // this file would catch it going missing.
    const res = await request.get("/apple-touch-icon.png");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image");
  });

  test("serves the service worker and its offline fallback", async ({ request }) => {
    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toMatch(/javascript/);

    // The SW pre-caches this page at install; a 404 breaks offline silently.
    const offline = await request.get("/offline.html");
    expect(offline.status()).toBe(200);
  });
});
