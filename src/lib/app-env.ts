/**
 * Which deployment this code is running as.
 *
 * There are deliberately TWO markers, because they solve different problems at
 * different layers and neither can do the other's job:
 *
 *   1. `APP_ENV`, a **runtime** Worker var, read on the server. Used for the
 *      production-database safety guard in `supabase-admin.ts`. It must be
 *      runtime: a build-time value could be baked wrong and would then be
 *      unverifiable at the moment it matters.
 *
 *   2. `NEXT_PUBLIC_APP_ENV`, a **build-time** value inlined into the bundle.
 *      Used for the staging banner. It must be build-time: `/` is statically
 *      prerendered, so a runtime read would be evaluated during the build
 *      anyway and silently produce the wrong answer.
 *
 * Production is the default in both cases, so a missing or misspelled marker
 * fails safe: it can never turn a production deploy into a permissive one.
 */

export type AppEnv = "production" | "staging" | "development";

function normalize(raw: string | undefined): AppEnv {
  if (raw === "staging") return "staging";
  if (raw === "development") return "development";
  return "production";
}

/**
 * Build-time environment, safe to read from client components.
 * Set by `NEXT_PUBLIC_APP_ENV` during the staging build (see the CI workflow).
 */
export const PUBLIC_APP_ENV: AppEnv = normalize(process.env.NEXT_PUBLIC_APP_ENV);

/** Runtime environment, server-only. Set by the `APP_ENV` Worker var. */
export function serverAppEnv(): AppEnv {
  return normalize(process.env.APP_ENV);
}

/**
 * Throws if a non-production deployment is about to talk to the production
 * database.
 *
 * This exists because the Supabase URL falls back to production when
 * `SUPABASE_URL` is unset, correct for the production Worker, catastrophic
 * anywhere else. A staging deploy missing that one var would otherwise read and
 * write real user data with no visible symptom. Failing to boot is strictly
 * better than succeeding against the wrong database.
 */
export function assertNotProductionDatabase(
  url: string,
  productionUrl: string,
  appEnv: AppEnv,
): void {
  if (appEnv !== "production" && url === productionUrl) {
    throw new Error(
      `Refusing to connect to the production database from APP_ENV="${appEnv}". ` +
        "Set SUPABASE_URL (and a matching SUPABASE_SERVICE_ROLE_KEY) for this " +
        "environment, see docs/STAGING.md.",
    );
  }
}
