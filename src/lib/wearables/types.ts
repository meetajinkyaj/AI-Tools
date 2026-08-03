import type { DailyMetric } from "./metrics";

/**
 * The adapter contract every wearable vendor is squeezed into.
 *
 * Six vendors, six dialects, one shape. What varies between them is genuinely
 * only: where the OAuth endpoints are, what scopes to ask for, how to call the
 * data endpoints, and how to turn the answer into `DailyMetric[]`. Everything
 * else, refresh, retry, backoff, persistence, idempotent upsert, is written
 * once in `sync.ts` and shared, because that is where the subtle bugs live and
 * six copies of subtle would be six times the bugs.
 */

export type ProviderId =
  | "oura"
  | "fitbit"
  | "whoop"
  | "withings"
  | "garmin"
  | "ultrahuman";

/**
 * Display names, in one place because two places drift.
 *
 * `providers.ts` reads its `name` from here, and so does the merge when it has
 * to tag a series with whose number it is. If these ever diverge, a user sees
 * one spelling in Settings and another on a chart, and has no way to know they
 * are the same device.
 */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  oura: "Oura",
  fitbit: "Fitbit",
  whoop: "Whoop",
  withings: "Withings",
  garmin: "Garmin",
  ultrahuman: "Ultrahuman",
};

export interface OAuthTokens {
  accessToken: string;
  /**
   * Absent when the vendor issues non-expiring access tokens, present
   * otherwise. See `refreshRotates`, for several vendors this value CHANGES on
   * every refresh and must be written back.
   */
  refreshToken?: string;
  /** Seconds until the access token expires, as the vendor reports it. */
  expiresIn?: number;
  scope?: string;
  /** The vendor's own user id, when the token response carries it. */
  externalUserId?: string;
}

export interface WearableProvider {
  id: ProviderId;
  /** Shown in the connect UI. */
  name: string;
  /** One line explaining what connecting actually gets the user. */
  blurb: string;

  /* ----------------------------- credentials ---------------------------- */

  /** Env var names. Absent values mean "not configured", the UI hides it. */
  clientIdEnv: string;
  clientSecretEnv: string;

  /* -------------------------------- oauth -------------------------------- */

  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /**
   * Some vendors want the client credentials as an HTTP Basic header rather
   * than form fields, and reject the other form outright.
   */
  tokenAuth: "basic" | "body";
  /**
   * TRUE when a refresh returns a NEW refresh token and invalidates the old
   * one. This is the single nastiest failure mode in the whole integration: if
   * the new token is not persisted, the connection works exactly once more and
   * then dies permanently, with no error at the time it breaks. `sync.ts`
   * always writes back whatever it gets, so this flag exists to document the
   * hazard and to be asserted in tests, not to switch behaviour.
   */
  refreshRotates: boolean;

  /* -------------------------------- data --------------------------------- */

  /**
   * Pull and normalize a date window.
   *
   * `null` means the vendor does not support on-demand fetching. Garmin, which
   * is push-only, and its data arrives through a webhook instead.
   */
  fetchRange:
    | ((args: {
        accessToken: string;
        externalUserId: string | null;
        start: string;
        end: string;
      }) => Promise<DailyMetric[]>)
    | null;

  /**
   * How far back to ask for on a routine sync. Kept small because vendors rate
   * limit per user and a nightly 7-day window catches every late-arriving or
   * corrected night without ever needing a full re-pull.
   */
  syncWindowDays: number;

  /** Access needs an application and approval, not just registration. */
  requiresApproval?: boolean;
}

/** Thrown when a vendor says the grant is dead and the user must re-consent. */
export class ReauthRequired extends Error {
  constructor(public readonly provider: ProviderId, message: string) {
    super(message);
    this.name = "ReauthRequired";
  }
}
