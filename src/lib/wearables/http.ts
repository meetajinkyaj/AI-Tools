import "server-only";

import {
  budgetFor,
  isExhausted,
  noteRateLimit,
  pacingDelayMs,
  retryAfterMs,
} from "./rate-limit";
import { RateLimited, ReauthRequired, type ProviderId } from "./types";

/** Wall-clock pause. Bounded by MAX_PACING_DELAY_MS, never open-ended. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 *
 * THE BUDGET IS WATCHED HERE because this is the only place that sees every
 * request and every response. Adapters ask for data; none of them should have
 * to know how much of a shared allowance is left, and six copies of that
 * bookkeeping would be six chances to get it wrong. See `rate-limit.ts`.
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

  /*
   * STOP BEFORE ASKING, when the last response said there was nothing left.
   * Sending it anyway earns a 429, and enough of those in a row is how a vendor
   * decides an app is not worth serving.
   */
  const budget = budgetFor(provider);
  if (isExhausted(budget)) {
    throw new RateLimited(
      provider,
      `${provider} request budget exhausted, ${budget.resetSeconds ?? "?"}s until reset`,
      (budget.resetSeconds ?? 0) * 1000,
    );
  }

  // Slow down as the budget runs low, rather than sprinting into the wall.
  const pause = pacingDelayMs(budget);
  if (pause > 0) await sleep(pause);

  const res = await fetch(url, { ...rest, headers });
  noteRateLimit(provider, res.headers);

  if (res.status === 401 || res.status === 403) {
    throw new ReauthRequired(provider, `${provider} rejected the token (${res.status})`);
  }
  if (res.status === 429) {
    /*
     * Deliberately NOT retried here, and deliberately its own error type. The
     * budget is shared across every member, so this is the app's problem and
     * not this connection's: `syncConnection` must not count it against a grant
     * that is working perfectly. Every vendor here backfills, so the members
     * this cuts short lose a day of freshness and no data.
     */
    throw new RateLimited(
      provider,
      `${provider} rate limited (429)`,
      retryAfterMs(res.headers),
    );
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
