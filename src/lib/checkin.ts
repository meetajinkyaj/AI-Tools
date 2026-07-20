/**
 * Daily check-in domain logic: validation, streak, and the iki-points economy.
 * Pure and dependency-free so it can be unit tested and shared by the API route
 * and the UI. The DB shapes it maps to live in supabase/migrations/0002 & 0003.
 */

import { type ExerciseEntry, validateExercises } from "./exercises";
import { POINTS } from "./points";

// Point values live in src/lib/points.ts (single source of truth); these are
// aliases so the check-in economy reads from there.
/** iki-points awarded for the day's first check-in. */
export const CHECKIN_POINTS = POINTS.checkin;
/** One-time bonus when a streak reaches 7 days. */
export const STREAK_7_BONUS = POINTS.streak7Bonus;
/** One-time bonus when a streak reaches 30 days. */
export const STREAK_30_BONUS = POINTS.streak30Bonus;

export const MIN_ENERGY = 1;
export const MAX_ENERGY = 5;
const MAX_SLEEP_HOURS = 24;
const MAX_NOTE_LENGTH = 500;

/** Ledger reason codes (subset of points_transactions.reason). */
export type PointsReason = "checkin" | "streak_bonus";

export interface PointsAward {
  reason: PointsReason;
  amount: number;
}

/** The user-editable fields of a daily check-in. */
export interface CheckinInput {
  sleep_hours: number | null;
  energy_score: number; // 1..5
  training_logged: boolean;
  nutrition_note: string | null;
  exercises: ExerciseEntry[]; // what they did today, with per-activity duration
}

/** A daily_checkins row as returned by the API. */
export interface CheckinRow extends CheckinInput {
  id: string;
  user_id: string;
  checkin_date: string; // YYYY-MM-DD
  streak_count: number;
  created_at: string;
  updated_at: string;
}

export const ENERGY_LABELS: Record<number, string> = {
  1: "Depleted",
  2: "Low",
  3: "Okay",
  4: "Good",
  5: "Energized",
};

export type ValidationResult =
  | { ok: true; value: CheckinInput }
  | { ok: false; error: string };

/**
 * Validate and normalize an untrusted request body into a CheckinInput.
 * energy_score is required (the minimum meaningful check-in); the rest are
 * optional. Never throws.
 */
export function validateCheckinInput(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const energy = b.energy_score;
  if (
    typeof energy !== "number" ||
    !Number.isInteger(energy) ||
    energy < MIN_ENERGY ||
    energy > MAX_ENERGY
  ) {
    return { ok: false, error: "Energy score must be between 1 and 5" };
  }

  let sleepHours: number | null = null;
  if (b.sleep_hours !== undefined && b.sleep_hours !== null && b.sleep_hours !== "") {
    const s = typeof b.sleep_hours === "string" ? Number(b.sleep_hours) : b.sleep_hours;
    if (typeof s !== "number" || Number.isNaN(s) || s < 0 || s > MAX_SLEEP_HOURS) {
      return { ok: false, error: "Sleep hours must be between 0 and 24" };
    }
    sleepHours = s;
  }

  const note =
    typeof b.nutrition_note === "string" && b.nutrition_note.trim().length > 0
      ? b.nutrition_note.trim()
      : null;
  if (note !== null && note.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: "Note is too long" };
  }

  const exercises = validateExercises(b.exercises);
  if (!exercises.ok) {
    return { ok: false, error: exercises.error };
  }

  return {
    ok: true,
    value: {
      sleep_hours: sleepHours,
      energy_score: energy,
      training_logged: b.training_logged === true,
      nutrition_note: note,
      exercises: exercises.value,
    },
  };
}

/** Today's date as a UTC YYYY-MM-DD string. */
export function todayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD), computed in UTC. */
export function daysBetweenUTC(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const msA = Date.UTC(ay, am - 1, ad);
  const msB = Date.UTC(by, bm - 1, bd);
  return Math.round((msB - msA) / 86_400_000);
}

/**
 * The streak count for a check-in made `today`, given the most recent PRIOR
 * check-in. A gap of exactly one day continues the streak; anything else
 * restarts it at 1.
 */
export function computeStreak(
  prevDate: string | null,
  prevStreak: number,
  today: string,
): number {
  if (!prevDate) return 1;
  const gap = daysBetweenUTC(prevDate, today);
  if (gap === 0) return prevStreak; // already counted today — defensive
  if (gap === 1) return prevStreak + 1;
  return 1;
}

/** The points awarded for the day's first check-in at the given streak. */
export function computeAwards(newStreak: number): PointsAward[] {
  const awards: PointsAward[] = [{ reason: "checkin", amount: CHECKIN_POINTS }];
  if (newStreak === 7) awards.push({ reason: "streak_bonus", amount: STREAK_7_BONUS });
  if (newStreak === 30) awards.push({ reason: "streak_bonus", amount: STREAK_30_BONUS });
  return awards;
}

export function totalAwarded(awards: PointsAward[]): number {
  return awards.reduce((sum, a) => sum + a.amount, 0);
}

/**
 * The streak to display given the most recent check-in (of any day). It is
 * "alive" if the last check-in was today or yesterday; otherwise it's 0.
 */
export function displayStreak(
  mostRecentDate: string | null,
  mostRecentStreak: number,
  today: string,
): number {
  if (!mostRecentDate) return 0;
  const gap = daysBetweenUTC(mostRecentDate, today);
  if (gap === 0 || gap === 1) return mostRecentStreak;
  return 0;
}
