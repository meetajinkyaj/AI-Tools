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

/**
 * One workout session, as an adapter emits it.
 *
 * Sparse on purpose: no vendor fills every field. Oura reports calories and an
 * intensity label but no strain; Whoop reports strain and kilojoules but no
 * user label. Adapters fill what they have and leave the rest undefined.
 */
export interface WorkoutSession {
  /** The vendor's own id. Half the idempotency key, so it must be stable. */
  externalId: string;
  startedAt: string;
  endedAt: string;
  /** The day it belongs to, YYYY-MM-DD, in the vendor's local terms. */
  date: string;
  /** Vendor's sport name, free text. Taxonomies differ and are not normalized. */
  activity?: string;
  /** Vendor's own intensity label. NOT comparable across vendors. */
  intensity?: string;
  /** Whoop's 0-21 exertion model. Null everywhere else, and not a percentage. */
  strain?: number;
  /** kcal. Whoop reports kilojoules; its adapter converts before emitting. */
  calories?: number;
  distanceM?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  source?: string;
  /**
   * The vendor noticed this rather than the member starting it.
   *
   * Movement, not training. Only Fitbit tells us (`logType`), so everyone else
   * stays false: that is "they do not say", not "we know they did not".
   */
  autoDetected?: boolean;
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

  /**
   * Pull workout SESSIONS for a date window.
   *
   * Separate from `fetchRange` because the two have different shapes and
   * different storage: daily metrics upsert on (user, provider, date, metric),
   * sessions on (user, provider, external id). Absent when a vendor reports no
   * workouts, or when we do not request the scope for them.
   */
  fetchWorkouts?: (args: {
    accessToken: string;
    externalUserId: string | null;
    start: string;
    end: string;
  }) => Promise<WorkoutSession[]>;

  /**
   * Tell the vendor the user has disconnected, so the grant dies at their end
   * too and not only in our database.
   *
   * OPTIONAL, AND ITS ABSENCE IS A STATEMENT. Deleting our row destroys our
   * copy of the credentials, so we can never call that vendor again either
   * way; what survives without this is the authorisation sitting in the user's
   * vendor account, which is why reconnecting goes straight to consent with no
   * sign-in. Removing that is the vendor's to do and only some of them expose
   * a way to ask.
   *
   * IMPLEMENTED ONLY WHERE THE ENDPOINT IS CONFIRMED FROM THE VENDOR'S OWN
   * DOCUMENTATION. A guessed revoke URL 404s quietly and leaves us believing
   * we revoked something we did not, which is worse than a documented gap: it
   * is a privacy claim we cannot support. `docs/WEARABLES.md` lists who has
   * one and who is still open.
   *
   * Best effort by contract. Throwing is fine; the caller disconnects anyway.
   */
  revoke?: (args: {
    accessToken: string;
    refreshToken: string | null;
    clientId: string;
    clientSecret: string;
    /**
     * MUST be passed to every fetch this makes. The caller bounds it, because
     * a vendor that accepts the connection and then says nothing would
     * otherwise hold up a disconnect the user is waiting on, and a Worker that
     * times out mid-revoke never reaches the delete: the member presses
     * Disconnect, sees a failure, and stays connected.
     */
    signal: AbortSignal;
  }) => Promise<void>;

  /**
   * Extra query parameters for the authorize URL, beyond the five every OAuth
   * provider needs.
   *
   * ADDED FOR GOOGLE, AND IT IS NOT OPTIONAL THERE. Google issues no refresh
   * token at all unless `access_type=offline` is on the authorize URL, and
   * sends one exactly once per grant unless `prompt=consent` forces a reissue.
   * Miss either and the connection works for an hour and then dies, with
   * nothing in the logs tying the failure to the cause. Whoop's `offline` scope
   * is the same trap wearing different clothes, and it cost a day.
   */
  extraAuthParams?: Record<string, string>;

  /** Access needs an application and approval, not just registration. */
  requiresApproval?: boolean;

  /**
   * This adapter targets an API that can no longer be reached, and setting its
   * credentials must NOT switch it on.
   *
   * WHY A FLAG RATHER THAN DELETING THE ADAPTER. An unconfigured provider is
   * already invisible, so the risk is not that users see it: it is that the
   * next person to read this file sees a complete, audited adapter and
   * concludes the integration is one registration away. When the vendor has
   * closed registration, that conclusion costs an afternoon and produces
   * credentials nothing in the stack can call.
   *
   * The value is the reason, in one line, shown wherever the provider is
   * listed. Anything truthy hides it from the connect UI regardless of
   * credentials.
   */
  unavailable?: string;
}

/** Thrown when a vendor says the grant is dead and the user must re-consent. */
export class ReauthRequired extends Error {
  constructor(public readonly provider: ProviderId, message: string) {
    super(message);
    this.name = "ReauthRequired";
  }
}
