import { expect, test } from "@playwright/test";

/**
 * Every data route must refuse an unauthenticated caller.
 *
 * This is the regression suite for the app's security posture. All Supabase
 * access runs through the service-role key, which bypasses Row Level Security, * so these route-level checks are not one layer of defense, they are THE layer.
 * A route that forgets its auth check is a full data leak, and nothing else in
 * the stack would stop it.
 *
 * Read-only: sends no credentials and writes nothing, so it is safe against any
 * target including production.
 */

/** Regular user routes → 401 without a valid Privy token. */
const USER_ROUTES: ReadonlyArray<[method: string, path: string]> = [
  ["GET", "/api/profile"],
  ["POST", "/api/profile"],
  ["GET", "/api/checkin"],
  ["POST", "/api/checkin"],
  ["GET", "/api/biomarkers"],
  ["POST", "/api/biomarkers"],
  ["POST", "/api/biomarkers/extract"],
  ["GET", "/api/trends"],
  ["GET", "/api/future"],
  ["GET", "/api/summary"],
  ["GET", "/api/interventions"],
  ["POST", "/api/interventions"],
  ["GET", "/api/redemptions"],
  ["POST", "/api/redemptions"],
  ["POST", "/api/redemptions/click"],
  ["GET", "/api/referral"],
  ["POST", "/api/push/subscribe"],
  ["DELETE", "/api/push/subscribe"],
  ["POST", "/api/auth/sync"],
];

/** Admin routes → 403. Never 200, and never a body containing user data. */
const ADMIN_ROUTES: ReadonlyArray<[method: string, path: string]> = [
  ["GET", "/api/admin/me"],
  ["GET", "/api/admin/users"],
  ["PATCH", "/api/admin/users"],
  ["GET", "/api/admin/analytics"],
  ["GET", "/api/admin/vouchers"],
  ["POST", "/api/admin/vouchers"],
  ["PATCH", "/api/admin/vouchers"],
  ["DELETE", "/api/admin/vouchers"],
  ["POST", "/api/admin/vouchers/codes"],
];

async function call(request: import("@playwright/test").APIRequestContext, method: string, path: string) {
  return request.fetch(path, {
    method,
    // A body on every method keeps JSON-parsing routes from failing before
    // their auth check, we want to prove auth rejects, not that parsing did.
    data: {},
    failOnStatusCode: false,
  });
}

test.describe("unauthenticated API access", () => {
  for (const [method, path] of USER_ROUTES) {
    test(`${method} ${path} → 401`, async ({ request }) => {
      const res = await call(request, method, path);
      expect(res.status(), `${method} ${path} must reject anonymous callers`).toBe(401);
    });
  }

  for (const [method, path] of ADMIN_ROUTES) {
    test(`${method} ${path} → 403`, async ({ request }) => {
      const res = await call(request, method, path);
      expect(res.status(), `${method} ${path} must reject non-admins`).toBe(403);
    });
  }

  test("a malformed bearer token is rejected, not trusted", async ({ request }) => {
    for (const token of ["not-a-token", "Bearer", "null", "a.b.c"]) {
      const res = await request.get("/api/profile", {
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      });
      expect(res.status(), `token "${token}" must not authenticate`).toBe(401);
    }
  });

  test("the reminders cron endpoint requires its secret", async ({ request }) => {
    // 401 where CRON_SECRET is configured (staging, production); 503 "not
    // configured" on a local build without it. Both refuse. What must never
    // happen is a 200, that would hand a list of users to any caller.
    const attempts: Record<string, string>[] = [{}, { Authorization: "Bearer wrong-secret" }];
    for (const headers of attempts) {
      const res = await request.get("/api/cron/due-reminders", {
        headers,
        failOnStatusCode: false,
      });
      expect([401, 503], `got ${res.status()}, the cron endpoint must refuse`).toContain(
        res.status(),
      );
      expect(await res.text()).not.toContain("subscriptions");
    }
  });

  test("no rejected response leaks user data", async ({ request }) => {
    // A 401/403 that still returned rows would be the bug this whole suite
    // exists to catch, so check the bodies rather than trusting status codes.
    for (const [method, path] of [...USER_ROUTES, ...ADMIN_ROUTES]) {
      const res = await call(request, method, path);
      const body = await res.text();
      expect(body, `${method} ${path} leaked an email`).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
      expect(body.length, `${method} ${path} returned a suspiciously large body`).toBeLessThan(500);
    }
  });
});
