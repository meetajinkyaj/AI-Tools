/**
 * "Future You" domain logic — a directional six-month outlook. Pure and
 * dependency-free so it can be unit tested and shared by the API route.
 *
 * Design constraint (product): lab panels arrive once or twice a YEAR, so the
 * engine of the projection is the user's daily inputs (check-in consistency,
 * sleep, training, energy), and the annual panel is the scoreboard. Concretely:
 *   - Habit momentum (0-100) is computed from recent check-ins and always leads.
 *   - A flagged marker gets a DIRECTIONAL outlook driven by momentum — never an
 *     invented number — while a marker with 2+ real data points earns a clamped
 *     linear projection (model "linear_v1").
 * Everything here is motivational, not diagnostic; copy stays directional and
 * the UI carries the standard disclaimer.
 */

import { type CheckinPoint, daysBetween, healthyImprovement, summarizeCheckins } from "./trends";

// ---- Habit momentum -------------------------------------------------------

export const MOMENTUM_WINDOW_DAYS = 30;
/** Six months, matching the checklist's projection horizon. */
export const HORIZON_DAYS = 182;
/** Suggested gap between panels (~6 months — users test once or twice a year). */
export const RETEST_AFTER_DAYS = 182;

export interface HabitSignals {
  /** Check-ins made / days in window (0..1). */
  checkinRate: number;
  avgSleep: number | null;
  trainingDaysPerWeek: number;
  /** Recent-window energy minus the window before (null = not enough data). */
  energyDelta: number | null;
}

export interface Momentum {
  score: number; // 0..100
  level: "strong" | "building" | "early";
  signals: HabitSignals;
}

/** Summarize the habit inputs that actually drive change between panels. */
export function computeHabitSignals(
  checkins: CheckinPoint[],
  windowDays = MOMENTUM_WINDOW_DAYS,
): HabitSignals {
  const trend = summarizeCheckins(checkins, windowDays);
  const weeks = windowDays / 7;
  return {
    checkinRate: Math.min(1, trend.count / windowDays),
    avgSleep: trend.avgSleep,
    trainingDaysPerWeek: Math.round((trend.trainingDays / weeks) * 10) / 10,
    energyDelta: trend.energyDelta,
  };
}

/**
 * A transparent 0-100 momentum score. Weights are deliberately simple and
 * inspectable: consistency 35, sleep 25, training 25, energy trend 15.
 */
export function computeMomentum(signals: HabitSignals): Momentum {
  let score = 0;
  score += Math.round(signals.checkinRate * 35);
  if (signals.avgSleep != null) {
    score += signals.avgSleep >= 7 ? 25 : signals.avgSleep >= 6 ? 15 : 5;
  }
  if (signals.trainingDaysPerWeek >= 3) score += 25;
  else if (signals.trainingDaysPerWeek >= 1) score += 15;
  if (signals.energyDelta != null && signals.energyDelta > 0) score += 15;
  else if (signals.energyDelta != null && signals.energyDelta === 0) score += 8;

  const level = score >= 70 ? "strong" : score >= 40 ? "building" : "early";
  return { score, level, signals };
}

// ---- Marker outlooks ------------------------------------------------------

export interface MarkerPoint {
  date: string; // YYYY-MM-DD (distinct test dates)
  value: number;
}

export interface MarkerOutlook {
  marker_key: string;
  marker_name: string | null;
  current_value: number | null;
  flag: string;
  /** "improving" | "holding" | "needs_inputs" — the directional read. */
  outlook: "improving" | "holding" | "needs_inputs";
  /** Numeric projection, only when 2+ real data points exist (linear_v1). */
  projected_value: number | null;
  projection_date: string | null;
  model: "habit_v1" | "linear_v1";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Least-squares linear projection from 2+ real observations to the horizon,
 * clamped so the projected move never exceeds 30% of the current value —
 * a directional read, not a promise.
 */
export function projectLinear(
  history: MarkerPoint[],
  horizonDays = HORIZON_DAYS,
): { projected: number; projectionDate: string } | null {
  if (history.length < 2) return null;
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  const t0 = sorted[0].date;
  const xs = sorted.map((p) => daysBetween(t0, p.date));
  const ys = sorted.map((p) => p.value);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null; // all same date — no time axis
  const slope = num / den;
  const last = sorted[n - 1];
  const raw = last.value + slope * horizonDays;

  // Clamp: cap the projected change at 30% of the latest value (directional).
  const maxMove = Math.abs(last.value) * 0.3;
  const projected = round2(
    Math.max(last.value - maxMove, Math.min(last.value + maxMove, raw)),
  );

  const lastMs = Date.parse(last.date);
  const projectionDate = new Date(lastMs + horizonDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { projected, projectionDate };
}

/**
 * The outlook for one marker. With real history (2+ points) the direction comes
 * from the data itself; with a single panel it comes from habit momentum — the
 * daily inputs are what will move the next panel.
 */
export function markerOutlook(
  marker: {
    marker_key: string;
    marker_name: string | null;
    value: number | null;
    flag: string;
    direction?: string;
    ref_low?: number | null;
    ref_high?: number | null;
  },
  history: MarkerPoint[],
  momentum: Momentum,
): MarkerOutlook {
  const linear = projectLinear(history);
  if (linear && marker.value != null) {
    const improvement = healthyImprovement(
      marker.value,
      linear.projected,
      marker.direction,
      marker.ref_low,
      marker.ref_high,
    );
    return {
      marker_key: marker.marker_key,
      marker_name: marker.marker_name,
      current_value: marker.value,
      flag: marker.flag,
      outlook:
        improvement != null && improvement > 0
          ? "improving"
          : improvement != null && improvement < 0
            ? "needs_inputs"
            : "holding",
      projected_value: linear.projected,
      projection_date: linear.projectionDate,
      model: "linear_v1",
    };
  }

  // Cold start (one panel): direction rides on the daily inputs.
  const outlook =
    momentum.level === "strong"
      ? "improving"
      : momentum.level === "building"
        ? "holding"
        : "needs_inputs";
  return {
    marker_key: marker.marker_key,
    marker_name: marker.marker_name,
    current_value: marker.value,
    flag: marker.flag,
    outlook,
    projected_value: null,
    projection_date: null,
    model: "habit_v1",
  };
}

// ---- Re-test milestone ----------------------------------------------------

export interface RetestMilestone {
  lastPanelDate: string;
  dueDate: string;
  daysUntilDue: number; // negative = overdue
}

/** The next-panel scoreboard moment: ~6 months after the last panel. */
export function retestMilestone(
  lastPanelDate: string,
  today: string,
  afterDays = RETEST_AFTER_DAYS,
): RetestMilestone {
  const dueMs = Date.parse(lastPanelDate) + afterDays * 86_400_000;
  const dueDate = new Date(dueMs).toISOString().slice(0, 10);
  const daysUntilDue = Math.round((dueMs - Date.parse(today)) / 86_400_000);
  return { lastPanelDate, dueDate, daysUntilDue };
}
