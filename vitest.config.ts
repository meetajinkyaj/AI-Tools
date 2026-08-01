import { defineConfig } from "vitest/config";

/**
 * Unit tests only.
 *
 * Vitest's default `include` also matches `e2e/*.spec.ts`, which are Playwright
 * specs, they import from `@playwright/test` and would fail under Vitest with
 * a confusing error. The two runners are kept strictly apart:
 *
 *   npm test   → Vitest, src/**, pure logic, no network
 *   npm run e2e → Playwright, e2e/**, against a running app
 */
export default defineConfig({
  resolve: {
    // See test/server-only-stub.ts for why this alias exists.
    alias: [
      {
        find: /^server-only$/,
        replacement: new URL("./test/server-only-stub.ts", import.meta.url).pathname,
      },
    ],
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", ".next/**", ".open-next/**"],
  },
});
