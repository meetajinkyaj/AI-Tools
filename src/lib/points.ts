/**
 * The iki-points economy — a single source of truth for every point value.
 *
 * To retune the economy (e.g. scale first-panel uploads 200 → 100, or re-tests
 * 150 → 50, or bump the outcome bonus), change the number HERE and nowhere else.
 * All routes and logic read these constants; nothing hardcodes a value.
 */
export const POINTS = {
  /** First check-in of the day. */
  checkin: 10,
  /** One-time bonus at a 7-day streak. */
  streak7Bonus: 50,
  /** One-time bonus at a 30-day streak. */
  streak30Bonus: 250,
  /** First-ever lab panel uploaded — the most valuable data ask. */
  firstPanelUpload: 200,
  /** A genuinely new dated panel after the first (a re-test). */
  reTestUpload: 150,
  /** Referral: a friend signs up and completes onboarding. (Flow pending.) */
  referral: 150,
  /** Per marker that meaningfully improved between panels. */
  outcomeBonusPerMarker: 250,
} as const;

/** Ledger reason codes written to points_transactions.reason. */
export const POINTS_REASON = {
  checkin: "checkin",
  streak7: "streak_7_bonus",
  streak30: "streak_30_bonus",
  panelUpload: "panel_upload",
  reTest: "retest_upload",
  referral: "referral",
  outcomeBonus: "outcome_bonus",
} as const;

/** The earn (amount + reason) for uploading a panel, or null for no reward. */
export interface UploadEarn {
  amount: number;
  reason: string;
}

/**
 * How many points a panel upload earns, given the dates already on file:
 *   - the first-ever panel earns the first-upload bonus,
 *   - a genuinely new *dated* panel (a re-test) earns the re-test amount,
 *   - re-saving a date already on file, or an undated re-save, earns nothing
 *     (so the loop can't be farmed by re-uploading the same report).
 * Pure so the economy is unit-tested and trivially retunable via POINTS above.
 */
export function uploadEarn(
  testDate: string | null,
  priorTestDates: (string | null)[],
): UploadEarn | null {
  if (priorTestDates.length === 0) {
    return { amount: POINTS.firstPanelUpload, reason: POINTS_REASON.panelUpload };
  }
  const dateSeen = testDate != null && priorTestDates.includes(testDate);
  if (testDate != null && !dateSeen) {
    return { amount: POINTS.reTestUpload, reason: POINTS_REASON.reTest };
  }
  return null; // duplicate date / undated re-save — no reward
}
