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
  /** Referral tier 1: the friend signs up and completes onboarding. */
  referralOnboard: 100,
  /** Referral tier 2: the friend builds the habit (first 7-day streak). */
  referralStreak: 50,
  /** Referral tier 3: the friend uploads their first panel within 30 days. */
  referralPanel: 150,
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
  // Referral milestones (each pays the REFERRER once per referred friend;
  // reference_id on the txn is the referred user's id).
  referralOnboard: "referral",
  referralStreak: "referral_streak",
  referralPanel: "referral_panel",
  outcomeBonus: "outcome_bonus",
} as const;

/** Max a referrer can earn from one friend (shown in the invite card). */
export const REFERRAL_MAX_TOTAL =
  POINTS.referralOnboard + POINTS.referralStreak + POINTS.referralPanel;
/** The friend's first panel must land within this many days of joining. */
export const REFERRAL_PANEL_WINDOW_DAYS = 30;

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

/** A reading reduced to the fields that identify a report's content. */
export interface SignatureReading {
  marker_key: string;
  value: number | null;
  value_text?: string | null;
}

/**
 * A stable content signature for a panel: the sorted set of marker=value pairs,
 * independent of the test date or lab name. Two uploads of the *same* report
 * produce the same signature even if the (user-editable) test-date field was
 * changed — so the date-based earn can't be farmed by re-uploading one report
 * under many dates. Pure, so it's unit-tested and reused on both sides of the
 * comparison.
 */
export function panelContentSignature(readings: SignatureReading[]): string {
  return readings
    .map((r) => `${r.marker_key}=${r.value != null ? r.value : (r.value_text ?? "")}`)
    .sort()
    .join("|");
}

/**
 * True when a new panel's content matches one already on file — i.e. the same
 * report re-uploaded. Used to suppress the upload earn regardless of test date.
 */
export function isReplayUpload(
  newSignature: string,
  priorSignatures: string[],
): boolean {
  return priorSignatures.includes(newSignature);
}
