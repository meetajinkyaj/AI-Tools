import type { MergedSeries } from "./merge";

/**
 * Training load and recovery.
 *
 * WHY THIS IS NOT A BIOMARKER CORRELATION. The obvious thing to build from
 * workout data is "training moved your lipids", and there is no honest way to
 * say that yet. The path from a session to a marker runs through behaviour,
 * training drives eating, sleeping and hydrating, and it moves markers over a
 * panel cycle of roughly six months. Demonstrating it needs paired training and
 * panel data six months apart from the same person, which nobody has, us
 * included. The reasoning is in docs/WEARABLE_DATA.md.
 *
 * WHAT IS HONEST TODAY is the near half of that chain: how hard the last week
 * was, and whether the body is absorbing it. Both are visible in data we
 * already hold, and neither requires a claim we cannot support.
 *
 * SO THIS FILE PRODUCES A DESCRIPTION, NOT A PRESCRIPTION. It says what
 * happened and whether recovery markers moved with it. It does not tell anyone
 * to train, rest, or expect a marker to change. Everything here is a comparison
 * of a person against their own recent baseline, never against a population.
 */

/** One stored session, as the training view needs it. */
export interface WorkoutRow {
  workout_date: string;
  started_at: string;
  ended_at: string;
  activity?: string | null;
  /** Whoop only, 0-21. Never comparable to another vendor's number. */
  strain?: number | string | null;
  provider: string;
}

export interface TrainingLoad {
  /** Sessions inside the window. */
  sessions: number;
  /** Distinct days trained, which is the number people actually recognise. */
  days: number;
  /** Total minutes across sessions. */
  minutes: number;
  /** Distinct activities, most frequent first. */
  activities: string[];
  /** Days in the window that had no session at all. */
  restDays: number;
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Minutes between two ISO timestamps, or null if either is unusable. */
function durationMinutes(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 60_000);
}

/**
 * Summarise the sessions inside a window ending at `endDate` inclusive.
 *
 * COUNTS DAYS AS WELL AS SESSIONS, because they answer different questions and
 * people mean the second. "I trained four times this week" is days; a double
 * session on Tuesday is one training day and two sessions, and reporting it as
 * four would flatter the number in exactly the way a habit app must not.
 */
export function trainingLoad(
  workouts: WorkoutRow[],
  endDate: string,
  windowDays = 7,
): TrainingLoad {
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const empty: TrainingLoad = {
    sessions: 0,
    days: 0,
    minutes: 0,
    activities: [],
    restDays: Number.isFinite(endMs) ? windowDays : 0,
  };
  if (!Number.isFinite(endMs)) return empty;

  const from = new Date(endMs - (windowDays - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const inWindow = workouts.filter(
    (w) => w.workout_date >= from && w.workout_date <= endDate,
  );
  if (inWindow.length === 0) return empty;

  const days = new Set(inWindow.map((w) => w.workout_date));
  const minutes = inWindow.reduce(
    (sum, w) => sum + (durationMinutes(w.started_at, w.ended_at) ?? 0),
    0,
  );

  const counts = new Map<string, number>();
  for (const w of inWindow) {
    const a = (w.activity ?? "").trim();
    if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const activities = [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([a]) => a);

  return {
    sessions: inWindow.length,
    days: days.size,
    minutes,
    activities,
    restDays: Math.max(0, windowDays - days.size),
  };
}

export type RecoveryDirection = "recovering" | "holding" | "straining" | "unknown";

export interface RecoverySignal {
  direction: RecoveryDirection;
  /** Which metrics actually contributed. Empty when direction is "unknown". */
  basis: string[];
  /**
   * Plain-language summary. Descriptive, never advice: this file does not tell
   * anyone to rest, and a health app saying "take a day off" is a
   * recommendation it is not qualified to make.
   */
  summary: string;
}

/** Mean of the last `days` values of a series, newest-first agnostic. */
function windowMean(series: MergedSeries | undefined, endDate: string, days: number): number | null {
  if (!series || series.points.length === 0) return null;
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(endMs)) return null;
  const from = new Date(endMs - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const vals = series.points
    .filter((p) => p.date >= from && p.date <= endDate)
    .map((p) => p.value);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Is the body absorbing the recent load, compared with the fortnight before it?
 *
 * READS THREE MARKERS AND REQUIRES TWO TO AGREE. HRV up, resting heart rate
 * down and readiness up all point the same way; any one of them alone is noise,
 * since HRV in particular swings with alcohol, illness and a late meal. Needing
 * two makes the signal quiet rather than chatty, which is correct for something
 * a person reads about their own body.
 *
 * THRESHOLDS ARE PERCENTAGES OF THE PERSON'S OWN BASELINE, never population
 * ranges. A resting heart rate of 58 is unremarkable in isolation and means
 * something if yours is normally 51.
 */
export function recoverySignal(
  byMetric: Map<string, MergedSeries>,
  endDate: string,
  recentDays = 7,
): RecoverySignal {
  const unknown: RecoverySignal = {
    direction: "unknown",
    basis: [],
    summary: "Not enough device data yet to say how recovery is going.",
  };

  // The prior window is the same length, immediately before the recent one, so
  // a quiet fortnight is never measured against a busy week.
  const priorEndMs = Date.parse(`${endDate}T00:00:00Z`) - recentDays * 86_400_000;
  if (!Number.isFinite(priorEndMs)) return unknown;
  const priorEnd = new Date(priorEndMs).toISOString().slice(0, 10);

  /** +1 when the marker moved the recovering way, -1 the straining way. */
  const vote = (metric: string, betterWhenHigher: boolean, minPct: number): number | null => {
    const series = byMetric.get(metric);
    const now = windowMean(series, endDate, recentDays);
    const before = windowMean(series, priorEnd, recentDays);
    if (now === null || before === null || before === 0) return null;
    const pct = ((now - before) / Math.abs(before)) * 100;
    if (Math.abs(pct) < minPct) return 0;
    const up = pct > 0;
    return up === betterWhenHigher ? 1 : -1;
  };

  // Minimums are deliberately different. Resting heart rate is stable enough
  // that 3% is a real move; HRV is noisy enough that under 5% is nothing.
  const votes: [string, number | null][] = [
    ["HRV", vote("hrv", true, 5)],
    ["resting heart rate", vote("resting_heart_rate", false, 3)],
    ["readiness", vote("readiness_score", true, 3)],
  ];

  const counted = votes.filter(([, v]) => v !== null);
  if (counted.length < 2) return unknown;

  const score = counted.reduce((sum, [, v]) => sum + (v ?? 0), 0);
  const basis = counted.filter(([, v]) => v !== 0).map(([name]) => name);

  if (score >= 2) {
    return {
      direction: "recovering",
      basis,
      summary: `Your ${basis.join(" and ")} improved on the previous ${recentDays} days.`,
    };
  }
  if (score <= -2) {
    return {
      direction: "straining",
      basis,
      summary: `Your ${basis.join(" and ")} moved the other way from the previous ${recentDays} days.`,
    };
  }
  return {
    direction: "holding",
    basis,
    summary: `Recovery markers are about where they were over the previous ${recentDays} days.`,
  };
}
