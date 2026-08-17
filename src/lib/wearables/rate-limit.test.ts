import { afterEach, describe, expect, it, vi } from "vitest";

import {
  budgetFor,
  clearRateLimits,
  isExhausted,
  isFresh,
  MAX_PACING_DELAY_MS,
  noteRateLimit,
  pacingDelayMs,
  parseRateLimit,
  PACING_RESERVE,
  retryAfterMs,
  UNKNOWN_BUDGET,
} from "./rate-limit";
import { PROVIDERS } from "./providers";
import { classifyFailure } from "./sync";
import { RateLimited, ReauthRequired } from "./types";

/**
 * Staying inside a request budget that belongs to the app rather than to any
 * one member.
 *
 * The failure this prevents is not "a sync was slow". It is a member being
 * asked to reconnect a device that never broke, because five nightly sweeps in
 * a row ran out of budget before reaching them and each one counted against
 * their connection.
 */

const headers = (h: Record<string, string>) => new Headers(h);
const NOW = 1_760_000_000_000;

afterEach(() => {
  clearRateLimits();
  vi.unstubAllGlobals();
});

describe("parseRateLimit", () => {
  it("reads the plain headers", () => {
    const s = parseRateLimit(
      headers({ "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "98", "X-RateLimit-Reset": "42" }),
      NOW,
    );
    expect(s).toMatchObject({ limit: 100, remaining: 98, resetSeconds: 42, at: NOW });
  });

  it("takes the first window when the limit is a list", () => {
    // WHOOP send "100;window=60, 10000;window=86400", first being the limit the
    // client is closest to hitting, which is the one worth pacing against.
    const s = parseRateLimit(
      headers({ "X-RateLimit-Limit": "100;window=60, 10000;window=86400" }),
      NOW,
    );
    expect(s.limit).toBe(100);
  });

  it("returns nulls rather than guesses when a vendor sends nothing", () => {
    // Not every vendor publishes these. Inventing a budget would throttle all
    // of them on evidence none of them gave us.
    const s = parseRateLimit(headers({}), NOW);
    expect(s).toMatchObject({ limit: null, remaining: null, resetSeconds: null });
  });
});

describe("isFresh", () => {
  it("expires a snapshot once its window has passed", () => {
    /*
     * THE OUTAGE THIS PREVENTS. One response saying "0 remaining, resets in 30
     * seconds" would otherwise block every request for the life of the isolate,
     * which is a far worse failure than the rate limit it respects.
     */
    const s = parseRateLimit(headers({ "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "30" }), NOW);
    expect(isFresh(s, NOW + 29_000)).toBe(true);
    expect(isFresh(s, NOW + 31_000)).toBe(false);
    expect(isExhausted(s, NOW + 31_000)).toBe(false);
  });

  it("treats a never-recorded budget as unknown, not as empty", () => {
    expect(isFresh(UNKNOWN_BUDGET, NOW)).toBe(false);
    expect(isExhausted(UNKNOWN_BUDGET, NOW)).toBe(false);
    expect(pacingDelayMs(UNKNOWN_BUDGET, NOW)).toBe(0);
  });
});

describe("pacingDelayMs", () => {
  it("does not slow down while there is plenty left", () => {
    const s = parseRateLimit(
      headers({ "X-RateLimit-Remaining": String(PACING_RESERVE + 1), "X-RateLimit-Reset": "60" }),
      NOW,
    );
    expect(pacingDelayMs(s, NOW)).toBe(0);
  });

  it("spreads what is left across the time until it resets", () => {
    // 5 requests, 10 seconds: one every two seconds.
    const s = parseRateLimit(
      headers({ "X-RateLimit-Remaining": "5", "X-RateLimit-Reset": "10" }),
      NOW,
    );
    expect(pacingDelayMs(s, NOW)).toBe(2_000);
  });

  it("counts the time already elapsed since the reading", () => {
    // Waiting the full window from a five-second-old reading would overshoot
    // the reset and waste budget we are about to be given back.
    const s = parseRateLimit(
      headers({ "X-RateLimit-Remaining": "4", "X-RateLimit-Reset": "10" }),
      NOW,
    );
    expect(pacingDelayMs(s, NOW + 6_000)).toBe(1_000);
  });

  it("never waits longer than the cap, because a member may be watching", () => {
    const s = parseRateLimit(
      headers({ "X-RateLimit-Remaining": "1", "X-RateLimit-Reset": "3600" }),
      NOW,
    );
    expect(pacingDelayMs(s, NOW)).toBe(MAX_PACING_DELAY_MS);
  });

  it("does not pace at zero, because the caller stops instead of waiting", () => {
    const s = parseRateLimit(
      headers({ "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "30" }),
      NOW,
    );
    expect(pacingDelayMs(s, NOW)).toBe(0);
    expect(isExhausted(s, NOW)).toBe(true);
  });
});

describe("retryAfterMs", () => {
  it("prefers Retry-After, in seconds", () => {
    expect(retryAfterMs(headers({ "Retry-After": "30" }))).toBe(30_000);
  });

  it("falls back to the reset header", () => {
    expect(retryAfterMs(headers({ "X-RateLimit-Reset": "45" }))).toBe(45_000);
  });

  it("says nothing when the vendor said nothing", () => {
    expect(retryAfterMs(headers({}))).toBeNull();
  });
});

describe("the budget store", () => {
  it("remembers what a response reported", () => {
    noteRateLimit("whoop", headers({ "X-RateLimit-Remaining": "7", "X-RateLimit-Reset": "20" }), NOW);
    expect(budgetFor("whoop")).toMatchObject({ remaining: 7, resetSeconds: 20 });
  });

  it("does not let a header-less response erase a real reading", () => {
    // Token endpoints and error pages carry no rate-limit headers. Recording
    // them as "unknown" would silently switch pacing off mid-sweep.
    noteRateLimit("whoop", headers({ "X-RateLimit-Remaining": "3", "X-RateLimit-Reset": "20" }), NOW);
    noteRateLimit("whoop", headers({}), NOW);
    expect(budgetFor("whoop").remaining).toBe(3);
  });

  it("keeps vendors apart", () => {
    noteRateLimit("whoop", headers({ "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "60" }), NOW);
    expect(budgetFor("oura")).toBe(UNKNOWN_BUDGET);
  });
});

describe("providerFetch under a rate limit", () => {
  /** Whoop's adapter is the one with a real budget to spend. */
  const range = { accessToken: "t", externalUserId: null, start: "2026-08-01", end: "2026-08-07" };

  it("throws RateLimited on a 429 rather than a plain error", async () => {
    // The distinction is the entire point: a plain error counts against the
    // member's connection, and this must not.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("slow down", { status: 429, headers: { "Retry-After": "30" } })),
    );
    await expect(PROVIDERS.whoop.fetchRange!(range)).rejects.toBeInstanceOf(RateLimited);
  });

  it("stops asking once the vendor says the budget is gone", async () => {
    // One response reporting zero should end the run, not produce a 429 per
    // remaining request. Enough of those in a row is how an app stops being
    // served at all.
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "60" },
      }),
    );
    vi.stubGlobal("fetch", spy);

    await expect(PROVIDERS.whoop.fetchRange!(range)).rejects.toBeInstanceOf(RateLimited);
    // The first call goes out and reports zero; nothing after it does.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("carries the vendor's own wait time on the error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "12" } })),
    );
    await expect(PROVIDERS.whoop.fetchRange!(range)).rejects.toMatchObject({
      retryAfterMs: 12_000,
    });
  });

  it("is unaffected when a vendor publishes no budget headers at all", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ records: [] }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await expect(PROVIDERS.whoop.fetchRange!(range)).resolves.toEqual([]);
    // Sleep, recovery and workouts are three separate collections; none of them
    // should be held back on evidence the vendor never gave.
    expect(spy.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("what a rate limit costs the connection it lands on", () => {
  it("costs it nothing", () => {
    /*
     * THE BUG THIS FIXES, in one assertion. A 429 used to be an ordinary
     * error, so it incremented the connection's failure counter; five nightly
     * sweeps that ran out of budget before reaching the same member marked
     * their connection expired and asked them to reconnect a device that had
     * never failed. The budget is ours. The cost cannot be theirs.
     */
    const outcome = classifyFailure(new RateLimited("whoop", "429"), 4);
    expect(outcome).toEqual({ kind: "rate-limited" });
  });

  it("still counts a real vendor failure, and expires after enough of them", () => {
    expect(classifyFailure(new Error("whoop 500"), 0)).toEqual({
      kind: "error",
      failures: 1,
      expire: false,
    });
    expect(classifyFailure(new Error("whoop 500"), 4)).toEqual({
      kind: "error",
      failures: 5,
      expire: true,
    });
  });

  it("still asks for re-consent when the grant is genuinely dead", () => {
    expect(classifyFailure(new ReauthRequired("whoop", "401"), 0)).toEqual({ kind: "reauth" });
  });
});
