import { METRICS, type MetricKey } from "./metrics";
import type { ProviderId } from "./types";

/**
 * Merging several devices into one series per metric.
 *
 * A user can connect every provider at once, and many will connect two or three
 *, a ring for sleep, a watch for training, a scale for weight. So on any given
 * day the same metric can arrive from several sources at once, and something
 * has to decide what "your sleep on the 4th" actually is.
 *
 * WHY NOT AVERAGE. Averaging two devices' sleep produces a number neither
 * device reported and nobody can reconcile against their own app. Worse, it
 * quietly corrupts the common case: if the ring was on the charger and the
 * watch logged four restless hours, the honest answer is "four hours from the
 * watch", not the mean of one real number and one absent one.
 *
 * WHAT WE DO INSTEAD: pick one source per metric per day, by a ranked
 * preference, falling back down the list whenever the preferred device has
 * nothing for that day. The win from multiple devices is COVERAGE, filling the
 * nights the ring was charging, not consensus.
 *
 * Every merged point carries the source it came from, so the UI can say where
 * a number is from and a user can reconcile it against the vendor's own app.
 */

/**
 * Ranked preference per metric, best first.
 *
 * The order reflects what each device is actually built to measure rather than
 * any view about brands:
 *
 *   - Sleep and overnight physiology: a dedicated sleep wearable worn on the
 *     finger or wrist all night beats a watch that may not be worn to bed.
 *   - All-day movement: whatever is on the wrist all day beats a ring for step
 *     counting, which rings systematically under-report.
 *   - Body composition: a scale is the only device here that actually measures
 *     it; everything else is inferring or relaying.
 */
const SLEEP_FIRST: ProviderId[] = [
  "oura",
  "ultrahuman",
  "whoop",
  "garmin",
  "fitbit",
  "withings",
];

const MOVEMENT_FIRST: ProviderId[] = [
  "garmin",
  "fitbit",
  "whoop",
  "oura",
  "ultrahuman",
  "withings",
];

const SCALE_FIRST: ProviderId[] = [
  "withings",
  "fitbit",
  "garmin",
  "oura",
  "ultrahuman",
  "whoop",
];

/**
 * Only one vendor here reports glucose at all, so this ordering is nearly
 * theoretical. It exists because every metric needs a ranking, and because
 * "whoever reports it" is the right answer when a second CGM source appears.
 */
const CGM_FIRST: ProviderId[] = [
  "ultrahuman",
  "oura",
  "whoop",
  "garmin",
  "fitbit",
  "withings",
];

export const SOURCE_RANK: Record<MetricKey, ProviderId[]> = {
  glucose_avg: CGM_FIRST,
  glucose_variability: CGM_FIRST,
  glucose_time_in_target: CGM_FIRST,
  hba1c_estimated: CGM_FIRST,
  sleep_minutes: SLEEP_FIRST,
  sleep_score: SLEEP_FIRST,
  hrv: SLEEP_FIRST,
  readiness_score: SLEEP_FIRST,
  respiratory_rate: SLEEP_FIRST,
  spo2: SLEEP_FIRST,
  temperature_deviation: SLEEP_FIRST,
  resting_heart_rate: SLEEP_FIRST,
  steps: MOVEMENT_FIRST,
  active_calories: MOVEMENT_FIRST,
  vo2max: MOVEMENT_FIRST,
  weight_kg: SCALE_FIRST,
  body_fat_pct: SCALE_FIRST,
};

/** One row as it comes out of `wearable_daily_metrics`. */
export interface MetricRow {
  provider: string;
  metric_date: string;
  metric: string;
  value: number | string;
  source?: string | null;
}

/** One day of one metric, after the sources have been resolved. */
export interface MergedPoint {
  date: string;
  value: number;
  /** Which provider this specific day came from. Varies within a series. */
  source: ProviderId;
}

export interface MergedSeries {
  metric: MetricKey;
  unit: string;
  label: string;
  points: MergedPoint[];
  /** Every provider that contributed at least one day, best-ranked first. */
  sources: ProviderId[];
}

function rankOf(metric: MetricKey, provider: string): number {
  const i = SOURCE_RANK[metric].indexOf(provider as ProviderId);
  // Unknown providers sort last rather than being dropped: a provider added to
  // the adapters but forgotten here should degrade to "used only when it is the
  // only source", not vanish silently.
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/**
 * Postgres `numeric` arrives as a STRING over PostgREST.
 *
 * Comparing or charting it without parsing gives lexical ordering and NaN
 * arithmetic, "9" > "10", which is the kind of bug that looks like bad data
 * rather than bad code.
 */
function toNumber(v: number | string): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve many providers' rows into one series per metric.
 *
 * Deterministic: same input, same output, regardless of row order.
 */
export function mergeMetrics(rows: MetricRow[]): MergedSeries[] {
  // metric -> date -> best row so far
  const best = new Map<MetricKey, Map<string, { value: number; source: ProviderId; rank: number }>>();

  for (const row of rows) {
    const metric = row.metric as MetricKey;
    if (!(metric in METRICS)) continue; // unknown key: inert, not fatal
    const value = toNumber(row.value);
    if (value === null) continue;

    const rank = rankOf(metric, row.provider);
    const byDate = best.get(metric) ?? new Map();
    const current = byDate.get(row.metric_date);

    // Strictly better rank wins. Equal rank keeps the first seen, which cannot
    // happen in practice (one row per provider per day per metric) but makes
    // the function total rather than order-dependent if it ever did.
    if (!current || rank < current.rank) {
      byDate.set(row.metric_date, { value, source: row.provider as ProviderId, rank });
    }
    best.set(metric, byDate);
  }

  const out: MergedSeries[] = [];
  for (const [metric, byDate] of best) {
    const points = [...byDate.entries()]
      .map(([date, v]) => ({ date, value: v.value, source: v.source }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (points.length === 0) continue;

    const contributing = [...new Set(points.map((p) => p.source))].sort(
      (a, b) => rankOf(metric, a) - rankOf(metric, b),
    );

    out.push({
      metric,
      unit: METRICS[metric].unit,
      label: METRICS[metric].label,
      points,
      sources: contributing,
    });
  }

  // Stable, vocabulary order, so the same metrics appear in the same place
  // every time rather than shuffling with whatever synced last.
  const order = Object.keys(METRICS) as MetricKey[];
  return out.sort((a, b) => order.indexOf(a.metric) - order.indexOf(b.metric));
}

/** Mean of the last `days` of a series, or null when there is nothing. */
export function recentAverage(series: MergedSeries | undefined, days: number): number | null {
  if (!series || series.points.length === 0) return null;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const recent = series.points.filter((p) => p.date >= cutoff);
  if (recent.length === 0) return null;
  return recent.reduce((sum, p) => sum + p.value, 0) / recent.length;
}

/**
 * Measured sleep, in hours, for the momentum model.
 *
 * MEASURED BEATS REMEMBERED. Habit momentum currently uses the sleep hours a
 * user types into their check-in, which is an estimate made after the fact by
 * someone who was asleep for it. When a device is connected we have the real
 * thing, so it takes precedence, and returning null when no device has
 * reported keeps the self-reported path untouched for everyone else.
 */
export function measuredSleepHours(
  series: MergedSeries[],
  windowDays: number,
): number | null {
  const sleep = series.find((s) => s.metric === "sleep_minutes");
  const avgMinutes = recentAverage(sleep, windowDays);
  if (avgMinutes === null) return null;
  return Math.round((avgMinutes / 60) * 10) / 10;
}
