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

// ---- Outcome reward config (tunable) --------------------------------------

/** Points for one marker moving out-of-range → in-range between panels. */
export const OUTCOME_BONUS_POINTS = 250;
/** Max markers rewarded from a single new panel (bounds cost + gaming). */
export const OUTCOME_MAX_MARKERS = 3;
/** Panels must be at least this far apart to qualify (anti-gaming: no rapid
 * re-test farming, no cherry-picked same-week baseline). */
export const OUTCOME_MIN_DAYS_BETWEEN_PANELS = 60;

export interface MarkerReading {
  marker_key: string;
  marker_name?: string | null;
  value: number | null;
  flag: string; // 'in_range' | 'low' | 'high' | 'unknown'
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
 * Markers that moved out-of-range → in-range from `previous` to `latest`.
 * Returns [] if the panels are closer together than the minimum interval.
 * Deterministic: uses the stored flags (computed by the catalog engine), so it
 * can't be gamed by unit tricks — the values are already canonicalized.
 */
export function computeOutcomeAwards(
  previous: PanelSnapshot,
  latest: PanelSnapshot,
  opts: { minDays?: number; maxMarkers?: number; points?: number } = {},
): OutcomeAward[] {
  const minDays = opts.minDays ?? OUTCOME_MIN_DAYS_BETWEEN_PANELS;
  const maxMarkers = opts.maxMarkers ?? OUTCOME_MAX_MARKERS;
  const points = opts.points ?? OUTCOME_BONUS_POINTS;

  if (daysBetween(previous.date, latest.date) < minDays) return [];

  const prevByKey = new Map(previous.readings.map((r) => [r.marker_key, r]));
  const awards: OutcomeAward[] = [];

  for (const r of latest.readings) {
    const p = prevByKey.get(r.marker_key);
    if (!p) continue;
    if (FLAGGED.has(p.flag) && r.flag === "in_range") {
      const delta =
        r.value != null && p.value != null ? round2(r.value - p.value) : null;
      awards.push({
        marker_key: r.marker_key,
        marker_name: r.marker_name ?? p.marker_name ?? null,
        from_value: p.value,
        to_value: r.value,
        delta,
        points,
      });
    }
  }

  return awards.slice(0, maxMarkers);
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
    out.push({
      marker_key: r.marker_key,
      marker_name: r.marker_name ?? b.marker_name ?? null,
      baseline_value: b.value,
      latest_value: r.value,
      delta,
      latest_flag: r.flag,
      moved_into_range: FLAGGED.has(b.flag) && r.flag === "in_range",
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
