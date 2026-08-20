import "server-only";

import { createSupabaseAdmin } from "../supabase-admin";
import { decryptToken, encryptToken } from "./crypto";
import { isMetricKey, type DailyMetric } from "./metrics";
import { PROVIDERS } from "./providers";
import {
  RateLimited,
  ReauthRequired,
  type OAuthTokens,
  type ProviderId,
  type WearableProvider,
  type WorkoutSession,
} from "./types";

/**
 * Refresh, fetch, normalize, store. The shared half of every integration.
 *
 * The adapters describe eight vendors; everything that is easy to get subtly
 * wrong lives here, once:
 *
 *   - REFRESH TOKEN ROTATION. Most of these vendors return a new refresh token
 *     on every refresh and retire the old one. Persisting it is not optional
 *     and not a nicety: miss it and the connection keeps working until the
 *     access token expires, then dies permanently, hours later, with nothing in
 *     the logs tying the failure to the cause. The write-back below is
 *     unconditional for exactly that reason, we never reason about whether
 *     *this* vendor rotates.
 *
 *   - PERSIST BEFORE USE. The new tokens are written before the data call is
 *     made. If the fetch then fails, we have still banked the refresh; the
 *     other order throws away a valid new token whenever a vendor 500s, and
 *     that is unrecoverable.
 *
 *   - FAILURE IS NOT REVOCATION. A vendor being down increments a counter. Only
 *     an explicit 401/403 marks the connection as needing re-consent, because
 *     asking a user to reconnect their ring because Oura had a bad afternoon is
 *     a good way to lose the connection for real.
 */

const MAX_FAILURES = 5;
/** Refresh a little early, a token that expires mid-request is a failed sync. */
const EXPIRY_SKEW_SECONDS = 120;

export interface ConnectionRow {
  id: string;
  user_id: string;
  provider: ProviderId;
  external_user_id: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  status: string;
  failure_count: number;
  /**
   * Null until a sync has succeeded, which is what marks a connection as new.
   * Optional on the type because several call sites build one of these from a
   * `select("*")`, where it is always present, and treating it as required
   * would make those casts lie in the other direction.
   */
  last_sync_at?: string | null;
  /**
   * The scopes the vendor said were granted, space-separated, written at the
   * token exchange. Optional on the type for the same reason `last_sync_at` is:
   * several call sites build one of these from a `select("*")` where it is
   * always present, and requiring it would make those casts lie.
   */
  scopes?: string | null;
}

/**
 * How far back this sync should ask for.
 *
 * FIRST SYNC OR ROUTINE SYNC, and the difference is `last_sync_at`. A
 * connection that has never completed a sync gets the provider's backfill
 * window, so the member's own history is on the screen they land on after
 * connecting; everything after that gets the small nightly window, which is
 * all a correction or a late-arriving night needs.
 *
 * A RECONNECT IS NOT A FIRST SYNC. The callback upserts on (user, provider)
 * and leaves `last_sync_at` alone, so somebody who reconnects after a token
 * expiry keeps their history and takes the cheap window. That is deliberate:
 * their data is already stored, and re-pulling two months to re-write rows we
 * already hold is a request budget spent on nothing.
 *
 * `force` IS THE WAY BACK FOR EVERYBODY ELSE. Without it the backfill can only
 * ever reach members who connect after it ships: anybody already connected has
 * a `last_sync_at`, and reconnecting deliberately does not clear it, so there
 * is no path at all to the history sitting at the vendor. The manual "Sync
 * now" button passes it, which is the honest reading of that button anyway:
 * somebody standing in front of the app asking for their data wants all of it,
 * not the last seven days of it.
 */
export function syncWindowFor(
  provider: WearableProvider,
  conn: Pick<ConnectionRow, "last_sync_at">,
  force = false,
): number {
  const firstSync = force || !conn.last_sync_at;
  return firstSync ? (provider.backfillWindowDays ?? provider.syncWindowDays) : provider.syncWindowDays;
}

/* ------------------------------- token I/O -------------------------------- */

function clientCreds(p: WearableProvider): { id: string; secret: string } {
  const id = process.env[p.clientIdEnv];
  const secret = process.env[p.clientSecretEnv];
  if (!id || !secret) throw new Error(`${p.id} is not configured`);
  return { id, secret };
}

/**
 * Exchange an authorization code or a refresh token for tokens.
 *
 * One function for both because the two calls differ only in grant type, and
 * splitting them duplicated the vendor-specific auth handling that is the only
 * genuinely fiddly part.
 */
export async function requestTokens(
  provider: ProviderId,
  params: Record<string, string>,
): Promise<OAuthTokens> {
  const p = PROVIDERS[provider];
  const { id, secret } = clientCreds(p);

  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (p.tokenAuth === "basic") {
    headers.Authorization = `Basic ${btoa(`${id}:${secret}`)}`;
  } else {
    body.set("client_id", id);
    body.set("client_secret", secret);
  }

  const res = await fetch(p.tokenUrl, { method: "POST", headers, body });
  const text = await res.text();
  if (!res.ok) {
    // A refresh rejected with 4xx means the grant is gone, the user revoked
    // access at the vendor, or a rotated token was lost. Either way only
    // re-consent fixes it, so say so rather than retrying forever.
    if (res.status >= 400 && res.status < 500) {
      throw new ReauthRequired(provider, `${provider} token exchange failed: ${text.slice(0, 200)}`);
    }
    throw new Error(`${provider} token endpoint ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = JSON.parse(text) as Record<string, unknown>;
  // Withings wraps everything one level deeper, under `body`.
  const d = (json.body && typeof json.body === "object" ? json.body : json) as Record<string, unknown>;

  /*
   * SNAKE CASE OR CAMEL CASE, because COROS document both for the same
   * response. Their parameter table names `accessToken`, `refreshToken` and
   * `expiresIn`; the worked example three lines below it returns
   * `access_token`, `refresh_token` and `expires_in`. Reading only one spelling
   * means a token exchange that succeeded looks like one that returned nothing,
   * and the difference is invisible until a real member connects.
   */
  const str = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = d[k];
      if (typeof v === "string" && v !== "") return v;
      if (typeof v === "number") return String(v);
    }
    return undefined;
  };
  const numeric = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = d[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
        return Number(v);
      }
    }
    return undefined;
  };

  const accessToken = str("access_token", "accessToken") ?? "";
  if (!accessToken) {
    /*
     * SAY WHAT THE VENDOR SAID, when the vendor said anything. COROS answer a
     * refused code exchange with HTTP 200 and a `result` code in the body, so
     * this branch is where their failures land: bare, the message reads as our
     * parser losing a field, and the next person debugging a connect that will
     * not connect starts in the wrong file. Only COROS carry `result`, so
     * everyone else's message is unchanged.
     */
    const vendor = [d.result, d.message]
      .filter((v): v is string => typeof v === "string" && v !== "")
      .join(" ");
    throw new Error(
      `${provider} returned no access_token${vendor ? ` (vendor said: ${vendor})` : ""}`,
    );
  }

  return {
    accessToken,
    refreshToken: str("refresh_token", "refreshToken"),
    expiresIn: numeric("expires_in", "expiresIn"),
    scope: typeof d.scope === "string" ? d.scope : undefined,
    // `openId` is COROS's user identifier and the only thing that identifies a
    // member on every subsequent call, since their endpoints take it as a query
    // parameter rather than deriving it from the token.
    // `x_user_id` is Polar's. Their v4 endpoints do not take a user id at all,
    // so unlike COROS's `openId` nothing depends on capturing it; it is stored
    // because having the vendor's own id for a connection is what makes a
    // support conversation about one member's data possible.
    externalUserId: str("user_id", "userid", "openId", "open_id", "x_user_id"),
  };
}

/**
 * Extend an access token that the vendor refreshes in place.
 *
 * COROS's refresh answers `{"result":"0000","message":"OK"}`: no token, no
 * expiry, just an acknowledgement that the token you already hold now lives
 * another thirty days. `requestTokens` cannot express that, because its whole
 * contract is "returns credentials", and calling it here would throw on a
 * response that means success.
 *
 * Returns the new expiry, or throws. A refresh rejected 4xx means the grant is
 * gone the same way it does everywhere else.
 */
const EXTEND_DAYS = 30;

export async function extendToken(
  provider: ProviderId,
  refreshToken: string,
): Promise<{ expiresAt: string }> {
  const p = PROVIDERS[provider];
  const { id, secret } = clientCreds(p);

  const res = await fetch(p.refreshUrl ?? p.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      throw new ReauthRequired(provider, `${provider} refresh failed: ${text.slice(0, 200)}`);
    }
    throw new Error(`${provider} refresh endpoint ${res.status}: ${text.slice(0, 200)}`);
  }

  /*
   * THE BODY IS THE ANSWER, NOT THE STATUS CODE. COROS return HTTP 200 with a
   * `result` field, and only "0000" means it worked. Trusting the status alone
   * would bank thirty days of validity on a refresh that was refused, and the
   * connection would then fail silently a month later with nothing to point at.
   */
  let result: string | undefined;
  try {
    result = (JSON.parse(text) as { result?: string }).result;
  } catch {
    throw new Error(`${provider} refresh returned unparseable body: ${text.slice(0, 200)}`);
  }
  if (result !== "0000") {
    throw new Error(`${provider} refresh returned result ${result ?? "(none)"}`);
  }

  return { expiresAt: new Date(Date.now() + EXTEND_DAYS * 86_400_000).toISOString() };
}

/**
 * The encrypted-credential half of a connection row.
 *
 * Separated from the write so `connect` can put it in the SAME statement that
 * creates the row. See `persistTokens` for why that matters.
 */
export async function tokenColumns(tokens: OAuthTokens): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {
    access_token_enc: await encryptToken(tokens.accessToken),
    expires_at: tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  };
  // Only overwrite the refresh token when the vendor actually sent one. Some
  // return it on every refresh (rotation), some only at first grant, blanking
  // it in the second case would destroy the connection.
  if (tokens.refreshToken) {
    patch.refresh_token_enc = await encryptToken(tokens.refreshToken);
  }
  if (tokens.scope) patch.scopes = tokens.scope;
  if (tokens.externalUserId) patch.external_user_id = tokens.externalUserId;
  return patch;
}

/**
 * Write tokens back, encrypted. The REFRESH path only.
 *
 * Connect does not use this: it folds `tokenColumns` into its own upsert, so
 * the row and its credentials are one statement. Two statements produced a real
 * incident on 2026-08-03. The row was written, encryption then threw, and the
 * result was a connection with `status = 'active'` and no tokens at all: the UI
 * showed "Disconnect", nothing could ever sync, and `last_error` was null
 * because no sync had failed. A row that says connected without credentials is
 * worse than no row, because it looks like success to everybody.
 */
export async function persistTokens(
  connectionId: string,
  tokens: OAuthTokens,
  extra: Record<string, unknown> = {},
) {
  const supabase = createSupabaseAdmin();
  const patch = { ...(await tokenColumns(tokens)), ...extra };
  await supabase.from("wearable_connections").update(patch).eq("id", connectionId);
}

/**
 * A usable access token for this connection, refreshing if needed.
 *
 * Throws `ReauthRequired` when only the user can fix it.
 */
async function accessTokenFor(conn: ConnectionRow): Promise<string> {
  const expiresAt = conn.expires_at ? Date.parse(conn.expires_at) : null;
  const stillValid =
    expiresAt === null || expiresAt - EXPIRY_SKEW_SECONDS * 1000 > Date.now();

  if (stillValid) {
    const token = await decryptToken(conn.access_token_enc);
    if (token) return token;
    // Undecryptable ciphertext means the key changed or the row is corrupt.
    // Fall through and try to refresh; if that also fails, re-consent it is.
  }

  const refresh = await decryptToken(conn.refresh_token_enc);
  if (!refresh) {
    throw new ReauthRequired(conn.provider, "no usable refresh token stored");
  }

  /*
   * VENDORS THAT EXTEND RATHER THAN REISSUE. COROS's refresh returns an
   * acknowledgement and no credentials: the token already stored is the token
   * to keep using, now good for another thirty days. So the access token is
   * decrypted rather than received, and only the expiry is written.
   *
   * A token we cannot decrypt is unrecoverable on this path, because there is
   * no new one coming to replace it. That is a re-consent, and saying so beats
   * extending the life of a credential we cannot read.
   */
  if (PROVIDERS[conn.provider].refreshExtendsToken) {
    const existing = await decryptToken(conn.access_token_enc);
    if (!existing) {
      throw new ReauthRequired(
        conn.provider,
        "stored access token is unreadable and this vendor issues no replacement on refresh",
      );
    }
    const { expiresAt } = await extendToken(conn.provider, refresh);
    const supabase = createSupabaseAdmin();
    await supabase
      .from("wearable_connections")
      .update({ expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq("id", conn.id);
    return existing;
  }

  const tokens = await requestTokens(conn.provider, {
    grant_type: "refresh_token",
    refresh_token: refresh,
  });

  // Persisted BEFORE the token is used. If the caller's data fetch then fails,
  // the rotated refresh token is already banked, the other order silently
  // throws away a valid credential every time a vendor has a bad minute.
  await persistTokens(conn.id, tokens);
  return tokens.accessToken;
}

/**
 * Ask the vendor to tear down the grant, on the way out of a disconnect.
 *
 * BEST EFFORT, ALWAYS. Returns what happened instead of throwing, because the
 * caller must delete our row whatever the answer: a user who pressed
 * Disconnect has to end up disconnected even if the vendor is down, and a
 * failed revoke that blocked the delete would leave them connected to an app
 * they just left, holding live credentials. That is the worse of the two.
 *
 * NOT EVERY VENDOR CAN BE ASKED. `"unsupported"` means we have no revoke
 * endpoint confirmed from that vendor's own documentation, and guessing a URL
 * would leave us believing we revoked something we did not.
 *
 * Called BEFORE the row is deleted, since the credentials go with it.
 */
export type RevokeOutcome = "revoked" | "unsupported" | "failed" | "timed-out";

/**
 * How long a vendor gets to answer before we give up and disconnect anyway.
 *
 * THIS IS WHAT MAKES "BEST EFFORT" TRUE. Without a bound, "best effort" is a
 * comment rather than a behaviour: an unanswered socket would hold up a
 * request the user is watching a spinner on, and if the Worker gave up first
 * the delete would never run at all. The member would press Disconnect, see a
 * failure, and still be connected, which is the exact outcome this whole path
 * exists to prevent.
 *
 * Three seconds because nothing downstream depends on the answer. We are
 * telling the vendor something, not asking.
 */
const REVOKE_TIMEOUT_MS = 3_000;

export async function revokeAtVendor(conn: ConnectionRow): Promise<RevokeOutcome> {
  const p = PROVIDERS[conn.provider];
  if (!p?.revoke) return "unsupported";
  try {
    const { id, secret } = clientCreds(p);
    const refreshToken = await decryptToken(conn.refresh_token_enc);

    /*
     * A LIVE ACCESS TOKEN, REFRESHING IF THE STORED ONE HAS EXPIRED.
     *
     * The first version used the stored token as-is, reasoning that refreshing
     * in order to revoke mints a credential purely to destroy it. That reads
     * well and it broke Whoop, whose revoke authenticates with the member's
     * access token and whose access tokens last about an hour. Disconnect any
     * time after the nightly sync and the stored token is already dead: Whoop
     * answers 401, we log "failed", and the grant survives at their end. The
     * feature would have worked for one of the two providers that support it,
     * and only for the hour after a sync.
     *
     * Fitbit is unaffected either way, because its revoke takes the refresh
     * token.
     *
     * Refreshing is cheap and the objection was misplaced: a token minted here
     * is destroyed seconds later by the very call it enables. On a grant that
     * is genuinely dead the refresh throws, which lands in the catch below as
     * "failed", and the row is deleted regardless. Nothing is worse off.
     */
    let accessToken = await decryptToken(conn.access_token_enc);
    const expiresAt = conn.expires_at ? Date.parse(conn.expires_at) : null;
    const expired =
      expiresAt !== null && expiresAt - EXPIRY_SKEW_SECONDS * 1000 <= Date.now();
    if ((expired || !accessToken) && refreshToken) {
      const tokens = await requestTokens(conn.provider, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      accessToken = tokens.accessToken;
      // NOT persisted, deliberately. The row is about to be deleted, so
      // writing the rotated token back is work whose only effect would be to
      // widen the window in which a half-finished disconnect leaves live
      // credentials behind.
    }
    if (!accessToken && !refreshToken) return "failed";

    // Belt and braces. The signal tears the request down, and the race caps
    // the wait even if an implementation forgets to pass the signal on.
    const signal = AbortSignal.timeout(REVOKE_TIMEOUT_MS);
    const timedOut = new Promise<"timed-out">((resolve) =>
      setTimeout(() => resolve("timed-out"), REVOKE_TIMEOUT_MS),
    );
    const outcome = await Promise.race([
      p
        .revoke({
          accessToken: accessToken ?? "",
          refreshToken,
          clientId: id,
          clientSecret: secret,
          signal,
        })
        .then(() => "revoked" as const),
      timedOut,
    ]);
    if (outcome === "timed-out") {
      console.warn(`vendor revoke for ${conn.provider} timed out, disconnecting anyway`);
    }
    return outcome;
  } catch (err) {
    // Logged, never surfaced. The user asked to disconnect, not to hear about
    // our conversation with a vendor.
    console.warn(`vendor revoke failed for ${conn.provider}:`, err);
    return "failed";
  }
}

/* --------------------------------- store ---------------------------------- */

/**
 * Upsert a batch of normalized metrics.
 *
 * Conflict target is (user, provider, date, metric), so re-syncing a window
 * corrects rather than duplicates, which is what makes the nightly overlapping
 * window safe, and what lets a vendor revise last night's sleep score without
 * leaving us holding both answers.
 */
export async function storeMetrics(
  userId: string,
  provider: ProviderId,
  metrics: DailyMetric[],
): Promise<number> {
  const clean = metrics.filter(
    (m) => isMetricKey(m.metric) && Number.isFinite(m.value) && /^\d{4}-\d{2}-\d{2}$/.test(m.date),
  );
  if (clean.length === 0) return 0;

  /*
   * ONE ROW PER CONFLICT KEY, OR POSTGRES REJECTS THE WHOLE BATCH.
   *
   * `ON CONFLICT DO UPDATE` cannot touch the same row twice in one statement:
   * two entries sharing (user, provider, date, metric) raise SQLSTATE 21000 and
   * the ENTIRE upsert is lost, not just the duplicate. A sync that produced one
   * accidental pair would store nothing at all, count as a failure, and after
   * five of those mark a perfectly good connection expired.
   *
   * The pair is easy to produce and nobody would notice writing it. Google
   * Health aggregates several sources under one account, so a member with a
   * Fitbit and a Pixel Watch can legitimately have two data points for one
   * calendar day; the same is true of any vendor that reports a value twice
   * because a session was revised.
   *
   * Deduped here rather than in each adapter, because it is a property of the
   * TABLE and eight adapters would each have to remember it. Last wins, matching
   * what the upsert itself would have done had the rows arrived separately.
   */
  const byKey = new Map<string, DailyMetric>();
  // Separator written as an escape, not a raw byte. A literal control
  // character in source makes grep treat the whole file as binary, which
  // silently excludes it from every repo-wide search, including the em dash
  // sweep in AGENTS.md. `\u0000` cannot occur in a date or a metric key, so
  // the collision guarantee is unchanged.
  for (const m of clean) byKey.set(`${m.date}\u0000${m.metric}`, m);
  const deduped = [...byKey.values()];

  const supabase = createSupabaseAdmin();
  const rows = deduped.map((m) => ({
    user_id: userId,
    provider,
    metric_date: m.date,
    metric: m.metric,
    value: m.value,
    source: m.source ?? provider,
    recorded_at: m.recordedAt ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("wearable_daily_metrics")
    .upsert(rows, { onConflict: "user_id,provider,metric_date,metric" });
  if (error) throw new Error(`storing ${provider} metrics failed: ${error.message}`);
  return rows.length;
}

/**
 * Upsert workout sessions.
 *
 * Conflict target is (user, provider, external id), NOT the day: several
 * sessions happen in one day, which is the whole reason these do not live in
 * `wearable_daily_metrics`. Re-syncing an overlapping window corrects a session
 * whose score the vendor revised, rather than duplicating it.
 */
export async function storeWorkouts(
  userId: string,
  provider: ProviderId,
  sessions: WorkoutSession[],
): Promise<number> {
  const clean = sessions.filter(
    (w) =>
      w.externalId &&
      w.startedAt &&
      w.endedAt &&
      /^\d{4}-\d{2}-\d{2}$/.test(w.date),
  );
  if (clean.length === 0) return 0;

  const supabase = createSupabaseAdmin();
  const rows = clean.map((w) => ({
    user_id: userId,
    provider,
    external_id: w.externalId,
    started_at: w.startedAt,
    ended_at: w.endedAt,
    workout_date: w.date,
    activity: w.activity ?? null,
    intensity: w.intensity ?? null,
    strain: w.strain ?? null,
    calories: w.calories ?? null,
    distance_m: w.distanceM ?? null,
    avg_heart_rate: w.avgHeartRate ?? null,
    max_heart_rate: w.maxHeartRate ?? null,
    source: w.source ?? provider,
    // Whether the member started it or their device noticed it. Only Fitbit
    // reports this; false elsewhere means "they do not say", not "we know".
    auto_detected: w.autoDetected === true,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("wearable_workouts")
    .upsert(rows, { onConflict: "user_id,provider,external_id" });
  if (error) throw new Error(`storing ${provider} workouts failed: ${error.message}`);
  return rows.length;
}

/* ---------------------------------- sync ---------------------------------- */

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface SyncResult {
  provider: ProviderId;
  stored: number;
  /**
   * `rate-limited` is not a failure of this connection and never counts as one.
   * See the RateLimited branch below.
   */
  status: "ok" | "reauth" | "error" | "skipped" | "rate-limited";
  error?: string;
}

/**
 * Sync one connection.
 *
 * Never throws: the caller is usually sweeping every connection in the system,
 * and one user's dead Whoop grant must not stop the other users' rings syncing.
 */
/**
 * What a failed sync means for the connection it happened on.
 *
 * SEPARATED FROM THE WRITING OF IT because this is the part with a rule in it,
 * and the rule is the thing worth being sure about. The database call is
 * mechanical; the judgement about whose fault a failure is, and whether it
 * should eventually cost a member their connection, is not.
 *
 * Three answers, and the first is the one this exists for:
 *
 *   - RATE LIMITED: nothing is recorded. The request budget is per app, shared
 *     across every member, so a member cut short by it has a healthy grant, a
 *     working device, and the bad luck of being late in tonight's queue.
 *     Counting it against them incremented `failure_count`, and five such
 *     nights marked their connection expired and asked them to reconnect a
 *     device that had never once failed. Their `last_sync_at` is left alone
 *     too, which puts them at the FRONT of the next run rather than the back.
 *
 *   - REAUTH: only the member can fix it, so stop trying and say so.
 *
 *   - ERROR: a vendor having a bad night. Counted, and only after enough
 *     consecutive nights does "transient" stop being a fair description.
 */
export type FailureOutcome =
  | { kind: "rate-limited" }
  | { kind: "reauth" }
  | { kind: "error"; failures: number; expire: boolean };

export function classifyFailure(err: unknown, priorFailures: number): FailureOutcome {
  if (err instanceof RateLimited) return { kind: "rate-limited" };
  if (err instanceof ReauthRequired) return { kind: "reauth" };
  const failures = priorFailures + 1;
  return { kind: "error", failures, expire: failures >= MAX_FAILURES };
}

export interface SyncOptions {
  /**
   * Ask for the provider's backfill window even though this connection has
   * synced before. Set by the manual "Sync now" path only: it is one member
   * pressing a button, not the nightly sweep, and it is the only route by which
   * an existing connection can pick up history it never asked for.
   */
  backfill?: boolean;
}

export async function syncConnection(
  conn: ConnectionRow,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const provider = PROVIDERS[conn.provider];
  const supabase = createSupabaseAdmin();

  // Garmin is push-only, there is no endpoint to poll. Skipping is correct,
  // not a failure, so it must not touch the failure counter.
  if (!provider.fetchRange) {
    return { provider: conn.provider, stored: 0, status: "skipped" };
  }

  try {
    const token = await accessTokenFor(conn);
    const end = new Date();
    const start = new Date(
      end.getTime() - syncWindowFor(provider, conn, options.backfill) * 86_400_000,
    );

    const metrics = await provider.fetchRange({
      accessToken: token,
      externalUserId: conn.external_user_id,
      // What this member actually agreed to, not what we asked for. See
      // `grantedScopes` in types.ts.
      grantedScopes: conn.scopes ?? null,
      start: isoDay(start),
      end: isoDay(end),
    });
    const stored = await storeMetrics(conn.user_id, conn.provider, metrics);

    // WORKOUTS ARE BEST EFFORT, and deliberately so. They are a second endpoint
    // behind a second scope, and a member who declined `workout` at the consent
    // screen would otherwise have their whole sync marked failed over data they
    // chose not to share. Sleep and recovery are the load-bearing half; a
    // missing workout list must not cost them.
    if (provider.fetchWorkouts) {
      try {
        const sessions = await provider.fetchWorkouts({
          accessToken: token,
          externalUserId: conn.external_user_id,
          grantedScopes: conn.scopes ?? null,
          start: isoDay(start),
          end: isoDay(end),
        });
        await storeWorkouts(conn.user_id, conn.provider, sessions);
      } catch (err) {
        console.warn(`${conn.provider} workout sync skipped:`, err);
      }
    }

    await supabase
      .from("wearable_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_error: null,
        failure_count: 0,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn.id);

    return { provider: conn.provider, stored, status: "ok" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const outcome = classifyFailure(err, conn.failure_count);

    if (outcome.kind === "rate-limited") {
      // Nothing is written at all. See classifyFailure for why.
      return { provider: conn.provider, stored: 0, status: "rate-limited", error: message };
    }

    if (outcome.kind === "reauth") {
      // The user has to act. Mark it and stop trying, repeated calls with a
      // dead grant are how you get rate limited by a vendor for nothing.
      await supabase
        .from("wearable_connections")
        .update({ status: "expired", last_error: message, updated_at: new Date().toISOString() })
        .eq("id", conn.id);
      return { provider: conn.provider, stored: 0, status: "reauth", error: message };
    }

    await supabase
      .from("wearable_connections")
      .update({
        failure_count: outcome.failures,
        last_error: message,
        ...(outcome.expire ? { status: "expired" } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn.id);

    return { provider: conn.provider, stored: 0, status: "error", error: message };
  }
}

/**
 * Every active connection for one user. Used by the manual "sync now".
 *
 * Defaults to the backfill window rather than the nightly one. A member presses
 * this button rarely and for one of two reasons: they have just connected, or
 * they think something is missing. Both are answered by asking for everything
 * the provider will give, and neither is answered by the seven days the sweep
 * would have fetched tonight anyway.
 */
export async function syncUser(
  userId: string,
  options: SyncOptions = { backfill: true },
): Promise<SyncResult[]> {
  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("wearable_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active");

  const results: SyncResult[] = [];
  for (const conn of (data ?? []) as ConnectionRow[]) {
    results.push(await syncConnection(conn, options));
  }
  return results;
}

/**
 * The scheduled sweep: the connections least recently synced, oldest first.
 *
 * Bounded per run rather than "everything", so one run cannot exceed the
 * Worker's CPU budget as the user count grows. Ordering by `last_sync_at`
 * ascending with nulls first means new connections sync immediately and nobody
 * can be starved, the longest-waiting is always next.
 *
 * A RATE LIMIT ENDS THE RUN FOR THAT VENDOR, rather than being met once per
 * remaining member. Their budget is per app, so the next request to that vendor
 * is already known to fail; sending fifty of them earns fifty 429s, which is
 * how an app stops being served at all. The members not reached keep their
 * `last_sync_at`, which is the oldest in the table, so they are at the front of
 * the next run. The queue slows down; nobody drops out of it.
 */
export async function syncDue(limit = 50): Promise<SyncResult[]> {
  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("wearable_connections")
    .select("*")
    .eq("status", "active")
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  const results: SyncResult[] = [];
  const paused = new Set<ProviderId>();

  for (const conn of (data ?? []) as ConnectionRow[]) {
    // Other vendors are unaffected: one exhausted budget is one vendor's.
    if (paused.has(conn.provider)) {
      results.push({ provider: conn.provider, stored: 0, status: "rate-limited" });
      continue;
    }
    const result = await syncConnection(conn);
    if (result.status === "rate-limited") paused.add(conn.provider);
    results.push(result);
  }
  return results;
}
