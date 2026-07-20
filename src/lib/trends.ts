/**
 * Trends & outcome-reward domain logic. Pure and dependency-free so it can be
 * unit tested and shared by the trends API and the biomarker save route.
 *
 * Two things share one panel-comparison core:
 *   1. Outcome-verified rewards — points for a marker that genuinely moved from
 *      out-of-range into range between two panels (the moat feature). Guarded
 *      against gaming: panels must be far enough apart, only "was flagged → now
 *      in range" counts, and the count is capped.
 *   2. The trends view — per-marker baseline→latest deltas, plus a check-in
 *      (energy/sleep) trend, which is where the *frequent* signal lives (lab
 *      panels are months apart; check-ins and wearables are daily).
 */

import { POINTS } from "./points";

// ---- Outcome reward config (tunable) --------------------------------------

/** Points for one marker that meaningfully improved between panels.
 * (Value lives in src/lib/points.ts — the single source of truth.) */
export const OUTCOME_BONUS_POINTS = POINTS.outcomeBonusPerMarker;
/** Max markers rewarded from a single new panel (bounds cost + gaming). */
export const OUTCOME_MAX_MARKERS = 3;
/** Panels closer than this are still accepted and shown in trends (critical
 * health data), but not rewarded — during illness/recovery markers swing a lot
 * (WBC/RBC especially), so a bi-weekly floor keeps rewards tied to real change. */
export const OUTCOME_MIN_DAYS_BETWEEN_PANELS = 14;
/** A reward needs a real move, not noise: the healthy-direction change must be at
 * least this fraction of the previous value (e.g. 5%). */
export const OUTCOME_MIN_IMPROVEMENT_PCT = 0.05;

export interface MarkerReading {
  marker_key: string;
  marker_name?: string | null;
  value: number | null;
  flag: string; // 'in_range' | 'low' | 'high' | 'unknown'
  direction?: string; // 'in_range' | 'lower_better' | 'higher_better'
  ref_low?: number | null;
  ref_high?: number | null;
}

/** How far a value sits outside its reference range (0 if inside). */
function outOfRangeDistance(
  value: number,
  refLow: number | null | undefined,
  refHigh: number | null | undefined,
): number {
  if (refLow != null && value < refLow) return refLow - value;
  if (refHigh != null && value > refHigh) return value - refHigh;
  return 0;
}

/**
 * The size of a healthy-direction move from prev→latest (positive = improved).
 * - lower_better: any decrease is improvement (keeps rewarding 9→8→6.5).
 * - higher_better: any increase is improvement.
 * - in_range: getting closer to the range (reducing out-of-range distance);
 *   fluctuation *within* range is not improvement.
 */
export function healthyImprovement(
  prevValue: number | null,
  latestValue: number | null,
  direction: string | undefined,
  refLow: number | null | undefined,
  refHigh: number | null | undefined,
): number | null {
  if (prevValue == null || latestValue == null) return null;
  if (direction === "lower_better") return prevValue - latestValue;
  if (direction === "higher_better") return latestValue - prevValue;
  // in_range (both-sided): reward reduced distance to the range.
  return (
    outOfRangeDistance(prevValue, refLow, refHigh) -
    outOfRangeDistance(latestValue, refLow, refHigh)
  );
}

export interface PanelSnapshot {
  /** Prefer test_date; fall back to created_at for the interval check. */
  date: string; // YYYY-MM-DD or ISO
  readings: MarkerReading[];
}

export interface OutcomeAward {
  marker_key: string;
  marker_name: string | null;
  from_value: number | null;
  to_value: number | null;
  delta: number | null;
  points: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Whole days between two date strings (absolute). */
export function daysBetween(a: string, b: string): number {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return 0;
  return Math.abs(Math.round((db - da) / 86_400_000));
}

const FLAGGED = new Set(["low", "high"]);

/**
 * Markers that meaningfully improved in their healthy direction from `previous`
 * to `latest` — including continued improvement past the range boundary
 * (visceral fat 9→8→6.5 all count). Returns [] if the panels are closer than the
 * minimum interval (accepted, but not rewarded). Deterministic: uses stored
 * values (already canonicalized) + the catalog `direction`, so it can't be gamed
 * by unit tricks, and a %-of-value threshold filters out noise.
 */
export function computeOutcomeAwards(
  previous: PanelSnapshot,
  latest: PanelSnapshot,
  opts: {
    minDays?: number;
    maxMarkers?: number;
    points?: number;
    minImprovementPct?: number;
  } = {},
): OutcomeAward[] {
  const minDays = opts.minDays ?? OUTCOME_MIN_DAYS_BETWEEN_PANELS;
  const maxMarkers = opts.maxMarkers ?? OUTCOME_MAX_MARKERS;
  const points = opts.points ?? OUTCOME_BONUS_POINTS;
  const minPct = opts.minImprovementPct ?? OUTCOME_MIN_IMPROVEMENT_PCT;

  if (daysBetween(previous.date, latest.date) < minDays) return [];

  const prevByKey = new Map(previous.readings.map((r) => [r.marker_key, r]));
  const scored: (OutcomeAward & { improvement: number })[] = [];

  for (const r of latest.readings) {
    const p = prevByKey.get(r.marker_key);
    if (!p || p.value == null || p.value === 0) continue;

    const improvement = healthyImprovement(
      p.value,
      r.value,
      r.direction ?? p.direction,
      r.ref_low ?? p.ref_low,
      r.ref_high ?? p.ref_high,
    );
    if (improvement == null || improvement <= 0) continue;
    if (improvement < minPct * Math.abs(p.value)) continue; // noise floor

    scored.push({
      marker_key: r.marker_key,
      marker_name: r.marker_name ?? p.marker_name ?? null,
      from_value: p.value,
      to_value: r.value,
      delta: r.value != null ? round2(r.value - p.value) : null,
      points,
      improvement: round2(improvement),
    });
  }

  // Reward the biggest genuine moves first, capped.
  return scored
    .sort((a, b) => b.improvement - a.improvement)
    .slice(0, maxMarkers)
    .map(
      (s): OutcomeAward => ({
        marker_key: s.marker_key,
        marker_name: s.marker_name,
        from_value: s.from_value,
        to_value: s.to_value,
        delta: s.delta,
        points: s.points,
      }),
    );
}

// ---- Trends display -------------------------------------------------------

export interface MarkerDelta {
  marker_key: string;
  marker_name: string | null;
  baseline_value: number | null;
  latest_value: number | null;
  delta: number | null;
  latest_flag: string;
  moved_into_range: boolean;
  improved: boolean; // moved in the healthy direction (incl. within-range gains)
}

/** Per-marker baseline→latest delta for the markers present in both panels. */
export function diffPanels(
  baseline: PanelSnapshot,
  latest: PanelSnapshot,
): MarkerDelta[] {
  const baseByKey = new Map(baseline.readings.map((r) => [r.marker_key, r]));
  const out: MarkerDelta[] = [];
  for (const r of latest.readings) {
    const b = baseByKey.get(r.marker_key);
    if (!b) continue;
    const delta =
      r.value != null && b.value != null ? round2(r.value - b.value) : null;
    const improvement = healthyImprovement(
      b.value,
      r.value,
      r.direction ?? b.direction,
      r.ref_low ?? b.ref_low,
      r.ref_high ?? b.ref_high,
    );
    out.push({
      marker_key: r.marker_key,
      marker_name: r.marker_name ?? b.marker_name ?? null,
      baseline_value: b.value,
      latest_value: r.value,
      delta,
      latest_flag: r.flag,
      moved_into_range: FLAGGED.has(b.flag) && r.flag === "in_range",
      improved: improvement != null && improvement > 0,
    });
  }
  return out;
}

// ---- Check-in trend (the frequent signal) ---------------------------------

export interface CheckinPoint {
  checkin_date: string;
  energy_score: number | null;
  sleep_hours: number | null;
  training_logged?: boolean;
}

export interface CheckinTrend {
  count: number;
  avgEnergy: number | null;
  avgSleep: number | null;
  energyDelta: number | null; // recent window vs the window before it
  sleepDelta: number | null;
  trainingDays: number;
}

function avg(nums: number[]): number | null {
  return nums.length ? round2(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

/**
 * Summarize recent check-ins: averages over the last `window` days, and the
 * change vs the `window` before that. Expects points newest-first or any order.
 */
export function summarizeCheckins(
  points: CheckinPoint[],
  window = 7,
): CheckinTrend {
  const sorted = [...points].sort((a, b) =>
    a.checkin_date < b.checkin_date ? 1 : -1,
  ); // newest first
  const recent = sorted.slice(0, window);
  const prior = sorted.slice(window, window * 2);

  const energyOf = (ps: CheckinPoint[]) =>
    avg(ps.map((p) => p.energy_score).filter((n): n is number => n != null));
  const sleepOf = (ps: CheckinPoint[]) =>
    avg(ps.map((p) => p.sleep_hours).filter((n): n is number => n != null));

  const recentEnergy = energyOf(recent);
  const priorEnergy = energyOf(prior);
  const recentSleep = sleepOf(recent);
  const priorSleep = sleepOf(prior);

  return {
    count: sorted.length,
    avgEnergy: recentEnergy,
    avgSleep: recentSleep,
    energyDelta:
      recentEnergy != null && priorEnergy != null
        ? round2(recentEnergy - priorEnergy)
        : null,
    sleepDelta:
      recentSleep != null && priorSleep != null
        ? round2(recentSleep - priorSleep)
        : null,
    trainingDays: recent.filter((p) => p.training_logged).length,
  };
}
