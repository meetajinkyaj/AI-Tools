import "server-only";

import { ReauthRequired, type ProviderId } from "./types";

/**
 * The one HTTP call every adapter makes.
 *
 * Centralised so that the handling of the two answers that matter, "your token
 * is dead" and "you are going too fast", is identical across six vendors
 * rather than six slightly different guesses.
 *
 * 401/403 becomes `ReauthRequired`, which the sync loop turns into a connection
 * the user is asked to reconnect. Everything else throws plainly and counts as
 * a transient failure, because a vendor having a bad afternoon should not make
 * a user re-consent.
 */
export async function providerFetch<T>(
  provider: ProviderId,
  url: string,
  init: RequestInit & { accessToken?: string } = {},
): Promise<T> {
  const { accessToken, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");

  const res = await fetch(url, { ...rest, headers });

  if (res.status === 401 || res.status === 403) {
    throw new ReauthRequired(provider, `${provider} rejected the token (${res.status})`);
  }
  if (res.status === 429) {
    // Deliberately NOT retried here. A per-user rate limit means backing off
    // until the next sweep, not sleeping inside a request the user is waiting
    // on, and every vendor here backfills, so a skipped run loses nothing.
    throw new Error(`${provider} rate limited (429)`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${provider} ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Number, or undefined if the vendor sent null/absent/garbage. */
export function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
