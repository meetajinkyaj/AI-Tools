import "server-only";

import { createSupabaseAdmin } from "../supabase-admin";
import { decryptToken, encryptToken } from "./crypto";
import { isMetricKey, type DailyMetric } from "./metrics";
import { PROVIDERS } from "./providers";
import { ReauthRequired, type OAuthTokens, type ProviderId, type WearableProvider } from "./types";

/**
 * Refresh, fetch, normalize, store. The shared half of every integration.
 *
 * The adapters describe six vendors; everything that is easy to get subtly
 * wrong lives here, once:
 *
 *   - REFRESH TOKEN ROTATION. Most of these vendors return a new refresh token
 *     on every refresh and retire the old one. Persisting it is not optional
 *     and not a nicety: miss it and the connection keeps working until the
 *     access token expires, then dies permanently, hours later, with nothing in
 *     the logs tying the failure to the cause. The write-back below is
 *     unconditional for exactly that reason — we never reason about whether
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
/** Refresh a little early — a token that expires mid-request is a failed sync. */
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
    // A refresh rejected with 4xx means the grant is gone — the user revoked
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

  const accessToken = typeof d.access_token === "string" ? d.access_token : "";
  if (!accessToken) throw new Error(`${provider} returned no access_token`);

  return {
    accessToken,
    refreshToken: typeof d.refresh_token === "string" ? d.refresh_token : undefined,
    expiresIn: typeof d.expires_in === "number" ? d.expires_in : undefined,
    scope: typeof d.scope === "string" ? d.scope : undefined,
    externalUserId:
      typeof d.user_id === "string"
        ? d.user_id
        : typeof d.userid === "string"
          ? d.userid
          : typeof d.user_id === "number"
            ? String(d.user_id)
            : undefined,
  };
}

/** Write tokens back, encrypted. Used by both connect and refresh. */
export async function persistTokens(
  connectionId: string,
  tokens: OAuthTokens,
  extra: Record<string, unknown> = {},
) {
  const supabase = createSupabaseAdmin();
  const patch: Record<string, unknown> = {
    access_token_enc: await encryptToken(tokens.accessToken),
    expires_at: tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
    ...extra,
  };
  // Only overwrite the refresh token when the vendor actually sent one. Some
  // return it on every refresh (rotation), some only at first grant — blanking
  // it in the second case would destroy the connection.
  if (tokens.refreshToken) {
    patch.refresh_token_enc = await encryptToken(tokens.refreshToken);
  }
  if (tokens.scope) patch.scopes = tokens.scope;
  if (tokens.externalUserId) patch.external_user_id = tokens.externalUserId;

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

  const tokens = await requestTokens(conn.provider, {
    grant_type: "refresh_token",
    refresh_token: refresh,
  });

  // Persisted BEFORE the token is used. If the caller's data fetch then fails,
  // the rotated refresh token is already banked — the other order silently
  // throws away a valid credential every time a vendor has a bad minute.
  await persistTokens(conn.id, tokens);
  return tokens.accessToken;
}

/* --------------------------------- store ---------------------------------- */

/**
 * Upsert a batch of normalized metrics.
 *
 * Conflict target is (user, provider, date, metric), so re-syncing a window
 * corrects rather than duplicates — which is what makes the nightly overlapping
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

  const supabase = createSupabaseAdmin();
  const rows = clean.map((m) => ({
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

/* ---------------------------------- sync ---------------------------------- */

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface SyncResult {
  provider: ProviderId;
  stored: number;
  status: "ok" | "reauth" | "error" | "skipped";
  error?: string;
}

/**
 * Sync one connection.
 *
 * Never throws: the caller is usually sweeping every connection in the system,
 * and one user's dead Whoop grant must not stop the other users' rings syncing.
 */
export async function syncConnection(conn: ConnectionRow): Promise<SyncResult> {
  const provider = PROVIDERS[conn.provider];
  const supabase = createSupabaseAdmin();

  // Garmin is push-only — there is no endpoint to poll. Skipping is correct,
  // not a failure, so it must not touch the failure counter.
  if (!provider.fetchRange) {
    return { provider: conn.provider, stored: 0, status: "skipped" };
  }

  try {
    const token = await accessTokenFor(conn);
    const end = new Date();
    const start = new Date(end.getTime() - provider.syncWindowDays * 86_400_000);

    const metrics = await provider.fetchRange({
      accessToken: token,
      externalUserId: conn.external_user_id,
      start: isoDay(start),
      end: isoDay(end),
    });
    const stored = await storeMetrics(conn.user_id, conn.provider, metrics);

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

    if (err instanceof ReauthRequired) {
      // The user has to act. Mark it and stop trying — repeated calls with a
      // dead grant are how you get rate limited by a vendor for nothing.
      await supabase
        .from("wearable_connections")
        .update({ status: "expired", last_error: message, updated_at: new Date().toISOString() })
        .eq("id", conn.id);
      return { provider: conn.provider, stored: 0, status: "reauth", error: message };
    }

    const failures = conn.failure_count + 1;
    await supabase
      .from("wearable_connections")
      .update({
        failure_count: failures,
        last_error: message,
        // Enough consecutive transient failures and it is not transient. Ask
        // the user to reconnect rather than retrying nightly forever.
        ...(failures >= MAX_FAILURES ? { status: "expired" } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn.id);

    return { provider: conn.provider, stored: 0, status: "error", error: message };
  }
}

/** Every active connection for one user. Used by the manual "sync now". */
export async function syncUser(userId: string): Promise<SyncResult[]> {
  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("wearable_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active");

  const results: SyncResult[] = [];
  for (const conn of (data ?? []) as ConnectionRow[]) {
    results.push(await syncConnection(conn));
  }
  return results;
}

/**
 * The scheduled sweep: the connections least recently synced, oldest first.
 *
 * Bounded per run rather than "everything", so one run cannot exceed the
 * Worker's CPU budget as the user count grows. Ordering by `last_sync_at`
 * ascending with nulls first means new connections sync immediately and nobody
 * can be starved — the longest-waiting is always next.
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
  for (const conn of (data ?? []) as ConnectionRow[]) {
    results.push(await syncConnection(conn));
  }
  return results;
}
