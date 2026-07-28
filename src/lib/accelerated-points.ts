/**
 * Accelerated Points — partner codes that earn at a multiplier.
 *
 * A community or brand gets a custom invite code with "AP partner" switched on
 * in the admin console; anyone who signs up through it earns faster and reaches
 * a redeemable voucher sooner. Schema and the reasoning behind it:
 * `supabase/migrations/0013_accelerated_points.sql`.
 *
 * Pure and dependency-free so the whole thing is unit-testable — this decides
 * how many points real people get, and it is not somewhere to find out later
 * that an edge case was wrong.
 */

/** What "accelerated" means today. One place, like every other point value. */
export const ACCELERATED_MULTIPLIER = 2;

/** Matches the CHECK constraint in 0013. Kept in sync deliberately. */
export const MIN_MULTIPLIER = 1;
export const MAX_MULTIPLIER = 5;

/**
 * Which earns accelerate.
 *
 * The rule is: **a multiplier rewards what the user did themselves.** Partner
 * users are being helped toward a voucher for their own habit — checking in,
 * uploading a panel, improving a marker.
 *
 * Referral milestones are deliberately excluded. Those pay a referrer for
 * someone ELSE's behaviour, so doubling them would (a) reward recruiting rather
 * than health, which is not what the partnership is buying, and (b) hand a
 * partner-code user a permanently better rate at farming signups than everyone
 * else. Neither is intended, and both are hard to unwind once the points are in
 * circulation.
 *
 * Listed by reason string rather than inferred, so a NEW earn reason has to be
 * classified on purpose. Forgetting to add one means it pays at 1× — visibly
 * stingy, and safe. Forgetting to exclude one would silently overpay forever.
 *
 * ⚠️ These are the strings the ledger ACTUALLY receives, which are not all in
 * `POINTS_REASON`. The check-in path builds its awards in `checkin.ts` and
 * writes `"streak_bonus"` for both the 7- and 30-day bonuses;
 * `POINTS_REASON.streak7` / `.streak30` ("streak_7_bonus" / "streak_30_bonus")
 * are declared but never written by anything. Validating this list against
 * `POINTS_REASON` therefore proves nothing — the tests drive it from the real
 * award producers (`computeAwards`, `uploadEarn`) instead.
 */
export const ACCELERATED_REASONS: readonly string[] = [
  "checkin",
  // Covers both the 7-day and 30-day bonuses — see the warning above.
  "streak_bonus",
  "panel_upload",
  "retest_upload",
  "outcome_bonus",
];

export function isAcceleratedReason(reason: string): boolean {
  return ACCELERATED_REASONS.includes(reason);
}

/* --------------------------- the rate itself ----------------------------- */

export interface MultiplierSource {
  /** Snapshotted on the user at signup. 1 means no acceleration. */
  points_multiplier?: number | string | null;
  /** Optional end date; null means it does not expire. */
  multiplier_expires_at?: string | null;
}

/**
 * The multiplier in force for a user right now.
 *
 * Postgres `numeric` arrives from PostgREST as a STRING, not a number — a
 * detail that would otherwise turn `2` into `"2"` and make `amount * m` produce
 * `NaN`, silently awarding nothing. Parsed and clamped here so no caller has to
 * remember.
 *
 * Anything unparseable, out of range, or expired falls back to 1×. Paying the
 * normal rate on bad data is a visible disappointment; paying a wrong inflated
 * rate is points in circulation that cannot be taken back.
 */
export function effectiveMultiplier(
  user: MultiplierSource | null | undefined,
  now: Date = new Date(),
): number {
  if (!user) return 1;

  const raw =
    typeof user.points_multiplier === "string"
      ? Number.parseFloat(user.points_multiplier)
      : user.points_multiplier;

  if (raw == null || !Number.isFinite(raw)) return 1;
  if (raw < MIN_MULTIPLIER) return 1;

  const expiry = user.multiplier_expires_at;
  if (expiry) {
    const expiresAt = Date.parse(expiry);
    // An unparseable expiry is treated as expired, not as "no expiry" — the
    // safe reading of a date we cannot understand is that the deal is over.
    if (!Number.isFinite(expiresAt) || now.getTime() >= expiresAt) return 1;
  }

  return Math.min(raw, MAX_MULTIPLIER);
}

/**
 * Apply a multiplier to one award.
 *
 * Rounds DOWN. Point values are whole numbers everywhere else in the economy,
 * and a fractional balance would leak into every total, the voucher threshold
 * and the shared card. Rounding down rather than to nearest means a multiplier
 * can never pay more than the arithmetic says.
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

export interface AcceleratedAward extends Award {
  /** What was actually applied — written to the ledger row. */
  multiplier: number;
  /** The pre-multiplier amount, for explaining a balance. */
  baseAmount: number;
}

/**
 * Accelerate a batch of awards, leaving ineligible reasons untouched.
 *
 * Every award carries the multiplier that produced it, so the ledger explains
 * itself: a 20-point check-in next to a 10-point one is otherwise a support
 * ticket nobody can answer.
 */
export function accelerateAwards(
  awards: readonly Award[],
  multiplier: number,
): AcceleratedAward[] {
  return awards.map((a) => {
    const applies = multiplier > 1 && isAcceleratedReason(a.reason);
    const m = applies ? multiplier : 1;
    return {
      reason: a.reason,
      baseAmount: a.amount,
      amount: applies ? applyMultiplier(a.amount, multiplier) : a.amount,
      multiplier: m,
    };
  });
}

export function totalAccelerated(awards: readonly AcceleratedAward[]): number {
  return awards.reduce((sum, a) => sum + a.amount, 0);
}
