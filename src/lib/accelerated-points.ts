/**
 * Accelerated Points — partner codes that earn faster, on a decaying glide path.
 *
 * A community or brand gets a custom invite code with "AP partner" switched on
 * in the admin console. Anyone who signs up through it earns at an elevated
 * rate that steps down over their first six months:
 *
 *   day 0–90     2.00x
 *   day 91–180   1.50x if they met the activity floor in the first 90 days,
 *                1.25x if they did not
 *   day 181+     1.25x steady state
 *
 * WHY A GLIDE PATH AND NOT A FLAT 2x. A permanent multiplier is an unbounded
 * liability: every user acquired through a partnership costs double the reward
 * spend for as long as they stay, forever, with no way to end it that isn't a
 * broken promise. Stepping down bounds the worst case from day one, and the
 * day-90 branch turns the boost into something you keep by using the app rather
 * than something you got for entering a code.
 *
 * WHAT IT DOES NOT TOUCH: `users.iki_score`, and therefore rank. Only the
 * spendable balance accelerates. See `iki-rank.ts` for why.
 */

/* ------------------------------ the schedule ----------------------------- */

export const BOOST_WINDOW_DAYS = 90;
export const GLIDE_END_DAYS = 180;

export const BOOST_INITIAL = 2.0;
/** Days 91–180, if the activity floor was met. */
export const BOOST_SUSTAINED = 1.5;
/** Days 91–180 without the floor, and the steady state for everyone after. */
export const BOOST_STEADY = 1.25;

/**
 * Check-ins required within the first 90 days to keep the higher rate.
 *
 * ⚠️ ASSUMPTION — confirm before the first partnership. Half the window: a
 * normal person who has a bad fortnight still clears it, a dormant account does
 * not. Change this one number to retune; nothing else depends on its value.
 */
export const ACTIVITY_FLOOR_CHECKINS = 45;

/** Matches the CHECK constraint on points_transactions.multiplier. */
export const MAX_MULTIPLIER = 5;

/**
 * Welcome balance granted when someone activates through a partner code
 * ("endowed progress" — starting at zero is the most abandonable state).
 *
 * ⚠️ ASSUMPTION — spendable only, and deliberately NOT counted toward
 * iki_score. A gift is not work, and rank has to stay a record of what someone
 * actually did or a partner code buys status. Set to 0 to disable.
 */
export const WELCOME_GRANT_POINTS = 150;

/* ------------------------------ eligibility ------------------------------ */

/**
 * Which earns accelerate: what the user did THEMSELVES.
 *
 * Referral milestones are excluded — they pay a referrer for someone else's
 * behaviour, so doubling them rewards recruiting rather than health and hands
 * partner users a permanently better rate at farming signups. The welcome grant
 * is excluded because multiplying a gift is just a bigger gift.
 *
 * ⚠️ These are the strings the ledger ACTUALLY receives, which are not all in
 * `POINTS_REASON`. The check-in path builds awards in `checkin.ts` and writes
 * `"streak_bonus"` for both the 7- and 30-day bonuses; `POINTS_REASON.streak7`
 * / `.streak30` are declared and never written. Validating this list against
 * `POINTS_REASON` therefore proves nothing — the tests drive it from the real
 * award producers instead.
 */
export const ACCELERATED_REASONS: readonly string[] = [
  "checkin",
  // Covers both the 7-day and 30-day bonuses — see the warning above.
  "streak_bonus",
  "panel_upload",
  "retest_upload",
  "outcome_bonus",
  // NOT listed, deliberately: referral, referral_streak, referral_panel,
  // referrer_7_friends, referrer_30_friends, welcome_grant. The referral ones
  // pay for someone else's behaviour; the grant is a gift.
];

/** Ledger reason for the partner welcome balance. */
export const WELCOME_GRANT_REASON = "welcome_grant";

/**
 * Earns that do NOT count toward lifetime rank.
 *
 * Only gifts. Everything a user earns — including referral milestones, which
 * are a real contribution — raises their score, just never at a multiplier.
 */
const RANK_EXCLUDED_REASONS: readonly string[] = [WELCOME_GRANT_REASON];

export function isAcceleratedReason(reason: string): boolean {
  return ACCELERATED_REASONS.includes(reason);
}

export function countsTowardRank(reason: string): boolean {
  return !RANK_EXCLUDED_REASONS.includes(reason);
}

/* --------------------------- the rate right now -------------------------- */

export interface BoostSource {
  /** When the boost window opened. Null/absent = never a partner signup. */
  boost_started_at?: string | null;
  /** Whether the activity floor was met; null = not yet evaluated. */
  boost_floor_met?: boolean | null;
}

const DAY_MS = 86_400_000;

/** Whole days elapsed since the window opened, or null if it never did. */
export function daysIntoBoost(
  user: BoostSource | null | undefined,
  now: Date = new Date(),
): number | null {
  const started = user?.boost_started_at;
  if (!started) return null;
  const startedAt = Date.parse(started);
  // An unreadable start date means we cannot place the user on the glide path.
  // Treated as "not boosted" rather than guessed at.
  if (!Number.isFinite(startedAt)) return null;
  const elapsed = now.getTime() - startedAt;
  if (elapsed < 0) return 0; // clock skew: treat a future start as day 0
  return Math.floor(elapsed / DAY_MS);
}

/**
 * The multiplier in force for this user right now.
 *
 * Everything unknown resolves to 1x. Paying the normal rate on bad data is a
 * visible disappointment; paying an inflated one puts points into circulation
 * that cannot be taken back.
 */
export function effectiveMultiplier(
  user: BoostSource | null | undefined,
  now: Date = new Date(),
): number {
  const day = daysIntoBoost(user, now);
  if (day === null) return 1;

  if (day < BOOST_WINDOW_DAYS) return BOOST_INITIAL;
  if (day < GLIDE_END_DAYS) {
    // Null (not yet evaluated) is treated as "floor not met" for this call.
    // Callers that can evaluate it should, and persist the answer.
    return user?.boost_floor_met === true ? BOOST_SUSTAINED : BOOST_STEADY;
  }
  return BOOST_STEADY;
}

/** True once the window has closed and the floor has not yet been judged. */
export function needsFloorEvaluation(
  user: BoostSource | null | undefined,
  now: Date = new Date(),
): boolean {
  const day = daysIntoBoost(user, now);
  return day !== null && day >= BOOST_WINDOW_DAYS && user?.boost_floor_met == null;
}

export function meetsActivityFloor(checkinsInWindow: number): boolean {
  return checkinsInWindow >= ACTIVITY_FLOOR_CHECKINS;
}

/* ------------------------------ applying it ------------------------------ */

/**
 * Rounds DOWN. Points are whole numbers everywhere else in the economy, and a
 * fraction would leak into balances, voucher thresholds and the shared card.
 * Down rather than nearest means a multiplier never pays more than the
 * arithmetic says.
 */
export function applyMultiplier(amount: number, multiplier: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(multiplier)) return 0;
  if (multiplier <= 1) return Math.trunc(amount);
  return Math.floor(amount * Math.min(multiplier, MAX_MULTIPLIER));
}

export interface Award {
  amount: number;
  reason: string;
}

export interface AcceleratedAward {
  reason: string;
  /** Unboosted. Added to iki_score when the reason counts toward rank. */
  baseAmount: number;
  /** Boosted. Credited to the spendable balance. */
  amount: number;
  multiplier: number;
}

export function accelerateAwards(
  awards: readonly Award[],
  multiplier: number,
): AcceleratedAward[] {
  return awards.map((a) => {
    const applies = multiplier > 1 && isAcceleratedReason(a.reason);
    return {
      reason: a.reason,
      baseAmount: a.amount,
      amount: applies ? applyMultiplier(a.amount, multiplier) : a.amount,
      multiplier: applies ? multiplier : 1,
    };
  });
}

/** What hits the spendable balance. */
export function totalSpendable(awards: readonly AcceleratedAward[]): number {
  return awards.reduce((sum, a) => sum + a.amount, 0);
}

/** What hits lifetime iki score — base only, gifts excluded. */
export function totalTowardRank(awards: readonly AcceleratedAward[]): number {
  return awards.reduce(
    (sum, a) => sum + (countsTowardRank(a.reason) ? a.baseAmount : 0),
    0,
  );
}
