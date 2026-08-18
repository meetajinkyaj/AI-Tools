import type { DailyMetric } from "./metrics";

/**
 * The adapter contract every wearable vendor is squeezed into.
 *
 * Seven vendors, seven dialects, one shape. What varies between them is genuinely
 * only: where the OAuth endpoints are, what scopes to ask for, how to call the
 * data endpoints, and how to turn the answer into `DailyMetric[]`. Everything
 * else, refresh, retry, backoff, persistence, idempotent upsert, is written
 * once in `sync.ts` and shared, because that is where the subtle bugs live and
 * seven copies of subtle would be seven times the bugs.
 */

export type ProviderId =
  | "oura"
  | "fitbit"
  | "whoop"
  | "withings"
  | "garmin"
  | "ultrahuman"
  | "coros";

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
  // WHOOP, not Whoop. Their brand guidelines set the wordmark in caps and
  // every surface they publish follows it; this string is what the app calls
  // the device out loud, so it follows it too. The other five vendors are
  // spelled the way their own brands spell them.
  whoop: "WHOOP",
  withings: "Withings",
  garmin: "Garmin",
  ultrahuman: "Ultrahuman",
  // COROS, not Coros. Their own materials set it in caps throughout, the same
  // reason WHOOP is spelled the way it is above.
  coros: "COROS",
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
   * Where a refresh is sent, when it is not `tokenUrl`.
   *
   * Most vendors refresh at the same endpoint that issued the token, with a
   * different grant type. COROS use a separate path (`/oauth2/refresh-token`),
   * so the two have to be allowed to differ.
   */
  refreshUrl?: string;

  /**
   * TRUE when a refresh EXTENDS the existing access token rather than issuing a
   * new one.
   *
   * COROS are the only vendor here that work this way, and the difference is
   * not cosmetic. Their refresh endpoint answers `{"result":"0000","message":
   * "OK"}` and nothing else: no token, no expiry. What it does is add thirty
   * days to the life of the token you already hold. Code that assumes a refresh
   * returns credentials throws "returned no access_token" on a response that
   * was, in fact, a complete success, and the connection dies on a working
   * grant.
   *
   * `refreshToken` never expires for these vendors either, so the credential to
   * protect is the one already stored.
   */
  refreshExtendsToken?: boolean;
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
   * How far back to ask for on the FIRST sync of a connection.
   *
   * WHY A SECOND NUMBER. `syncWindowDays` is tuned for the nightly sweep, where
   * a week is generous: it catches every late-arriving or corrected night at a
   * cost of one small request per member per day. Applied to a brand new
   * connection it is the wrong number for the opposite reason. The member has
   * months of history sitting at the vendor, and a week of it is not a trend;
   * the app looks empty on the one screen they open straight after connecting,
   * and the rest arrives a day at a time as the sweep inches forward.
   *
   * ONLY SET IT WHERE PAGINATION IS HANDLED. Every one of these vendors caps a
   * page and returns a continuation token, and most of these adapters read the
   * first page only, which is correct for a 7-day window and silently lossy for
   * a 60-day one. An adapter that has not been taught to follow its token must
   * leave this undefined, which falls back to `syncWindowDays` and changes
   * nothing.
   *
   * Absent means "same as a routine sync".
   */
  backfillWindowDays?: number;

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

/**
 * Thrown when the app has spent its request budget with a vendor.
 *
 * DISTINCT FROM EVERY OTHER FAILURE, because it is not about this connection.
 * The budget is per app, shared across every member, so a member whose sync is
 * cut short by it has done nothing wrong and their grant is perfectly healthy.
 * Treating it as an ordinary error incremented their failure counter, and five
 * such nights marked their connection expired and asked them to reconnect a
 * device that had never failed.
 *
 * `retryAfterMs` is what the vendor said, when they said anything.
 */
export class RateLimited extends Error {
  constructor(
    public readonly provider: ProviderId,
    message: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "RateLimited";
  }
}
