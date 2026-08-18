import { METRICS, VENDOR_SPECIFIC, type MetricKey } from "./metrics";
import { PROVIDER_NAMES, type ProviderId } from "./types";

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
  // COROS sits beside Garmin because it is the same kind of object: a large GPS
  // endurance watch, as likely to be on a charger overnight as on a wrist. It
  // publishes no sleep at all here (see providers.ts), so in this family it can
  // only ever win HRV and resting heart rate, and only on a night the devices
  // above it missed.
  "coros",
  "fitbit",
  "withings",
];

const MOVEMENT_FIRST: ProviderId[] = [
  "garmin",
  "fitbit",
  // Behind both, not beside them. COROS count steps from the wrist like the two
  // above, but step counting is the thing Fitbit was built to do and COROS is a
  // training watch that also does it. Third is not a demotion: it wins any day
  // the other two did not report.
  "coros",
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
  // Reports no body composition whatsoever, so this position is a formality:
  // a provider that never emits a metric never competes for it. Listed because
  // every provider has to appear in every ranking, and an absent id would be
  // indistinguishable from one somebody forgot.
  "coros",
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
  "coros",
];

/**
 * The four rankings above, named.
 *
 * WHY A MEMBER CHOOSES A FAMILY AND NOT A METRIC. Sleep, HRV, resting heart
 * rate, readiness, respiratory rate and blood oxygen all come off the same
 * device on the same night. Asking somebody to pick a source for each of them
 * is six questions with one answer, and it invites an incoherent state where
 * their sleep comes from the ring and their HRV from the watch that was not on
 * their wrist.
 */
export const METRIC_FAMILIES = ["sleep", "movement", "body", "glucose"] as const;
export type MetricFamily = (typeof METRIC_FAMILIES)[number];

/** Written for a member reading a settings screen, not for us. */
export const FAMILY_LABELS: Record<MetricFamily, string> = {
  sleep: "Sleep and recovery",
  movement: "Movement and activity",
  body: "Body composition",
  glucose: "Glucose",
};

/** What each family covers, so a picker can say what it is about to change. */
export const FAMILY_BLURBS: Record<MetricFamily, string> = {
  sleep: "Sleep, sleep score, readiness, HRV, resting heart rate, breathing, blood oxygen",
  movement: "Steps, active calories, VO₂ max",
  body: "Weight and body fat",
  glucose: "Average glucose, variability, time in target",
};

const FAMILY_RANK: Record<MetricFamily, ProviderId[]> = {
  sleep: SLEEP_FIRST,
  movement: MOVEMENT_FIRST,
  body: SCALE_FIRST,
  glucose: CGM_FIRST,
};

export const METRIC_FAMILY: Record<MetricKey, MetricFamily> = {
  glucose_avg: "glucose",
  glucose_variability: "glucose",
  glucose_time_in_target: "glucose",
  hba1c_estimated: "glucose",
  metabolic_score: "glucose",
  stress_high_minutes: "sleep",
  recovery_high_minutes: "sleep",
  vascular_age: "sleep",
  sleep_minutes: "sleep",
  sleep_score: "sleep",
  hrv: "sleep",
  readiness_score: "sleep",
  respiratory_rate: "sleep",
  spo2: "sleep",
  temperature_deviation: "sleep",
  resting_heart_rate: "sleep",
  steps: "movement",
  active_calories: "movement",
  vo2max: "movement",
  weight_kg: "body",
  body_fat_pct: "body",
};

/**
 * A member's chosen source per family. Absent means "use the default ranking".
 *
 * IT IS A PROMOTION, NOT A LOCK. The chosen provider sorts first and everything
 * else keeps its relative order behind it, so a night the preferred device
 * missed is still filled by the next best. Turning a preference into an
 * exclusive filter would mean a member who picked their ring loses every night
 * it was on the charger, which is the opposite of why anyone owns two devices.
 */
export type SourcePreferences = Partial<Record<MetricFamily, ProviderId>>;

export function isMetricFamily(v: unknown): v is MetricFamily {
  return typeof v === "string" && (METRIC_FAMILIES as readonly string[]).includes(v);
}

/**
 * The provider that will supply a family, given who is connected.
 *
 * Used by the settings screen to say what "Automatic" currently resolves to,
 * which is the difference between a member trusting the default and a member
 * wondering what it does. Returns null when nothing connected reports it.
 */
export function rankedForFamily(
  family: MetricFamily,
  connected: readonly ProviderId[],
): ProviderId[] {
  const set = new Set(connected);
  return FAMILY_RANK[family].filter((p) => set.has(p));
}

/**
 * DERIVED from the family map rather than written out again.
 *
 * This used to be a second literal listing all twenty-one metrics against the
 * four lists, which meant a new metric had to be added in two places and the
 * failure mode of forgetting one was silent: the metric would rank by one rule
 * and take its member preference from another. `Record<MetricKey, ...>` on
 * `METRIC_FAMILY` makes the compiler demand a family for every metric, so
 * there is now exactly one list to keep complete and it cannot be incomplete.
 */
export const SOURCE_RANK: Record<MetricKey, ProviderId[]> = Object.fromEntries(
  (Object.keys(METRIC_FAMILY) as MetricKey[]).map((m) => [m, FAMILY_RANK[METRIC_FAMILY[m]]]),
) as Record<MetricKey, ProviderId[]>;

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

/**
 * The label a series carries, with the vendor named when the number is theirs.
 *
 * "Metabolic score" reads like a fact about the body. "Metabolic score
 * (Ultrahuman)" reads like what it is: one company's formula. The tag is added
 * here rather than in each chart, so no consumer can forget it and no future
 * screen has to rediscover the reason.
 *
 * Only for `VENDOR_SPECIFIC` metrics, and only when exactly one provider
 * contributed. Two vendors' composites in one series should never happen (the
 * ranking picks one per day), and if it somehow did, a single vendor's name on
 * the label would be a worse lie than no name at all.
 */
export function seriesLabel(metric: MetricKey, sources: readonly ProviderId[]): string {
  const base = METRICS[metric].label;
  if (!VENDOR_SPECIFIC.has(metric) || sources.length !== 1) return base;
  const name = PROVIDER_NAMES[sources[0]];
  return name ? `${base} (${name})` : base;
}

function rankOf(
  metric: MetricKey,
  provider: string,
  prefs: SourcePreferences = {},
): number {
  // The member's own choice sorts ahead of everything, and ahead of nothing
  // else: the rest of the list keeps its order behind it, so this promotes a
  // device rather than excluding the others. -1 rather than 0 so it cannot tie
  // with the top of the default ranking.
  if (prefs[METRIC_FAMILY[metric]] === provider) return -1;

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
 *
 * `prefs` is the member's own choice of device per family, which promotes that
 * provider to the front of the ranking. Passing nothing is the default
 * behaviour and is correct for anyone who has not chosen, which is everybody
 * with fewer than two devices.
 *
 * EVERY CALLER MUST PASS THE SAME PREFERENCES. Two screens merging the same
 * rows with different rules is precisely the disagreement this whole file
 * exists to prevent, and it would be invisible: both numbers are real, they
 * just came from different devices. `loadSourcePreferences` is the one way to
 * read them.
 */
export function mergeMetrics(
  rows: MetricRow[],
  prefs: SourcePreferences = {},
): MergedSeries[] {
  // metric -> date -> best row so far
  const best = new Map<MetricKey, Map<string, { value: number; source: ProviderId; rank: number }>>();

  for (const row of rows) {
    const metric = row.metric as MetricKey;
    if (!(metric in METRICS)) continue; // unknown key: inert, not fatal
    const value = toNumber(row.value);
    if (value === null) continue;

    const rank = rankOf(metric, row.provider, prefs);
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
      (a, b) => rankOf(metric, a, prefs) - rankOf(metric, b, prefs),
    );

    out.push({
      metric,
      unit: METRICS[metric].unit,
      label: seriesLabel(metric, contributing),
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
