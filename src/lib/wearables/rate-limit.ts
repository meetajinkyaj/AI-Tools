/**
 * Staying inside a vendor's request budget, and failing honestly when we do not.
 *
 * THE NUMBER THAT MATTERS IS PER APP, NOT PER MEMBER. WHOOP allow 100 requests
 * a minute and 10,000 a day across every member we have, together. Our nightly
 * sweep walks connections one after another with nothing between them, which is
 * fine at ten members and is roughly two hundred requests a minute at a hundred
 * and fifty. Nothing warns us on the way there: the sweep simply starts getting
 * 429s partway down the list, and the members at the end of the list are the
 * ones who stop having data.
 *
 * WORSE THAN LOSING A NIGHT. Before this, a 429 was an ordinary error, so it
 * incremented that connection's failure counter; five consecutive nights of it
 * marked the connection `expired` and asked the member to reconnect a device
 * that had never had anything wrong with it. A budget we spent, charged to a
 * member who did not spend it.
 *
 * SO TWO MECHANISMS, AND THEY DO DIFFERENT JOBS.
 *
 *   1. Pacing. Every response carries the remaining budget; when it gets low we
 *      space out what is left over the time until it resets, so a sweep slows
 *      down before it hits the wall instead of running into it.
 *   2. Stopping. When the budget is actually gone, the run ends cleanly rather
 *      than hammering a closed door. `syncDue` orders by least-recently-synced,
 *      so whoever was not reached tonight is first in line tomorrow. Nobody is
 *      starved; the queue just moves more slowly than it would have.
 *
 * WHAT THIS IS NOT. The store below is per Worker isolate, so two concurrent
 * invocations do not see each other's counters. That is a real limit and it is
 * acceptable for now: the sweep is one scheduled run, and the manual path is one
 * member pressing a button. Coordinating properly needs shared state (a Durable
 * Object or KV), which is worth building when a second concurrent sweep exists,
 * and not before.
 */

export interface RateLimitSnapshot {
  /** The ceiling the vendor is reporting, or null if they did not say. */
  limit: number | null;
  /** Requests left in the current window. Null means unknown, not zero. */
  remaining: number | null;
  /** Seconds until the window resets. */
  resetSeconds: number | null;
  /** When we learned this, so a stale snapshot can be ignored. */
  at: number;
}

export const UNKNOWN_BUDGET: RateLimitSnapshot = {
  limit: null,
  remaining: null,
  resetSeconds: null,
  at: 0,
};

/**
 * How much of the budget to hold back before pacing starts.
 *
 * Pacing every request from the first one would slow a sweep that was never
 * going to hit the limit. Pacing only at zero would be no warning at all. Ten
 * is roughly two members' worth of requests: enough runway to slow down in.
 */
export const PACING_RESERVE = 10;

/**
 * The longest we will wait before a single request.
 *
 * A cron run can afford to be slow; a member watching a "Sync now" spinner
 * cannot, and both paths share this code. Two seconds is long enough to spread
 * a nearly-empty budget and short enough that nobody watches a spinner because
 * of it. When the budget is genuinely gone we stop rather than wait, which is
 * why this cap does not need to be generous.
 */
export const MAX_PACING_DELAY_MS = 2_000;

/**
 * Read the vendor's rate-limit headers.
 *
 * The format is the IETF draft one WHOOP link to: the limit may arrive as a
 * list of windows, `100;window=60, 10000;window=86400`, where the first entry
 * is the one the client is closest to hitting. Remaining and reset describe
 * that same closest limit, which is exactly the pair we want.
 *
 * Anything unparseable yields null rather than a guess. Null means "we do not
 * know", and every rule below treats not knowing as "do not slow down", because
 * inventing a budget nobody reported would throttle every vendor that does not
 * publish these headers at all.
 */
export function parseRateLimit(headers: Headers, now: number = Date.now()): RateLimitSnapshot {
  const int = (raw: string | null): number | null => {
    if (!raw) return null;
    // Takes the first integer, which handles both "98" and "100;window=60".
    const m = /-?\d+/.exec(raw);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  };

  const limit = int(headers.get("x-ratelimit-limit") ?? headers.get("ratelimit-limit"));
  let remaining = int(
    headers.get("x-ratelimit-remaining") ?? headers.get("ratelimit-remaining"),
  );

  /*
   * POLAR COUNT UP, NOT DOWN, AND THE DIFFERENCE IS THE WHOLE POINT.
   *
   * They send `RateLimit-Usage`: requests SPENT, where every other vendor here
   * sends requests LEFT. Dropping that number into `remaining` unconverted is
   * not a small error, it is the exact inverse: a nearly exhausted budget reads
   * as almost untouched, so `isExhausted` never fires and we sprint into a wall
   * of 429s; a fresh budget reads as nearly gone, so every request gets a
   * pacing delay it does not need. Both failures look like the vendor
   * misbehaving rather than like us misreading a header.
   *
   * Converted only when a limit is present, because "spent 40" means nothing
   * without "out of what", and a guess here is worse than not knowing.
   */
  if (remaining === null) {
    const usage = int(headers.get("ratelimit-usage") ?? headers.get("x-ratelimit-usage"));
    if (usage !== null && limit !== null) remaining = Math.max(0, limit - usage);
  }

  return {
    limit,
    remaining,
    resetSeconds: int(headers.get("x-ratelimit-reset") ?? headers.get("ratelimit-reset")),
    at: now,
  };
}

/**
 * Whether a snapshot still describes the present.
 *
 * A budget report is only true until its window resets. Without this, one
 * response saying "0 remaining, resets in 30 seconds" would block every request
 * for the rest of the isolate's life, which is a far worse outage than the rate
 * limit it was trying to respect.
 */
export function isFresh(s: RateLimitSnapshot, now: number = Date.now()): boolean {
  if (s.at === 0) return false;
  const windowMs = (s.resetSeconds ?? 60) * 1000;
  return now - s.at < windowMs;
}

/** The budget is spent. The caller should stop, not wait. */
export function isExhausted(s: RateLimitSnapshot, now: number = Date.now()): boolean {
  return isFresh(s, now) && s.remaining !== null && s.remaining <= 0;
}

/**
 * How long to wait before the next request, in milliseconds.
 *
 * Zero unless the budget is running low, and then whatever spreads what is left
 * evenly across the time until it resets. Eight requests and forty seconds to
 * go is a request every five seconds, capped.
 */
export function pacingDelayMs(s: RateLimitSnapshot, now: number = Date.now()): number {
  if (!isFresh(s, now)) return 0;
  if (s.remaining === null || s.remaining > PACING_RESERVE) return 0;
  if (s.remaining <= 0) return 0; // exhausted: the caller stops instead

  const windowMs = Math.max(0, (s.resetSeconds ?? 60) * 1000 - (now - s.at));
  return Math.min(Math.ceil(windowMs / s.remaining), MAX_PACING_DELAY_MS);
}

/**
 * How long a 429 says to wait, in milliseconds, or null.
 *
 * `Retry-After` is the standard answer and is in seconds; the rate-limit reset
 * header is the fallback for vendors that send one and not the other.
 */
export function retryAfterMs(headers: Headers): number | null {
  const retry = headers.get("retry-after");
  if (retry) {
    const n = Number(retry.trim());
    if (Number.isFinite(n) && n >= 0) return n * 1000;
  }
  const reset = headers.get("x-ratelimit-reset");
  if (reset) {
    const n = Number(/-?\d+/.exec(reset)?.[0]);
    if (Number.isFinite(n) && n >= 0) return n * 1000;
  }
  return null;
}

/* ------------------------------- the store -------------------------------- */

const budgets = new Map<string, RateLimitSnapshot>();

/** Record what a response told us about the remaining budget. */
export function noteRateLimit(provider: string, headers: Headers, now: number = Date.now()): void {
  const snapshot = parseRateLimit(headers, now);
  // A response with none of these headers tells us nothing, and overwriting a
  // real reading with an empty one would silently switch pacing off.
  if (snapshot.remaining === null && snapshot.limit === null) return;
  budgets.set(provider, snapshot);
}

/** What we last heard about this provider's budget. */
export function budgetFor(provider: string): RateLimitSnapshot {
  return budgets.get(provider) ?? UNKNOWN_BUDGET;
}

/** Test seam. Isolates are long-lived, so state has to be resettable. */
export function clearRateLimits(): void {
  budgets.clear();
}
