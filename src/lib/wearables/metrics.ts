/**
 * The canonical metric vocabulary every provider normalizes into.
 *
 * WHY A VOCABULARY AND NOT "WHATEVER THE VENDOR SENT". Six vendors describe
 * overlapping things in incompatible units and names: Oura reports sleep in
 * seconds, Fitbit in minutes; Whoop scores recovery 0-100, Oura scores
 * readiness 0-100, and they do not mean the same thing but they answer the same
 * question. If the raw shapes reach the rest of the app, then every chart, every
 * trend and every future feature has to know six dialects, and the seventh
 * vendor becomes a rewrite rather than a file.
 *
 * So the adapter boundary is where dialects stop. Downstream code only ever
 * sees these keys and these units.
 *
 * ADDING A METRIC is a change here plus a line in one or more adapters. It is
 * deliberately NOT a database migration: `wearable_daily_metrics.metric` is
 * free text, so an unrecognised key is inert data rather than a failed write.
 */

export const METRICS = {
  steps: { unit: "count", label: "Steps", precision: 0 },
  resting_heart_rate: { unit: "bpm", label: "Resting heart rate", precision: 0 },
  hrv: { unit: "ms", label: "HRV", precision: 0 },
  sleep_minutes: { unit: "min", label: "Sleep", precision: 0 },
  sleep_score: { unit: "score", label: "Sleep score", precision: 0 },
  readiness_score: { unit: "score", label: "Readiness", precision: 0 },
  active_calories: { unit: "kcal", label: "Active calories", precision: 0 },
  spo2: { unit: "%", label: "Blood oxygen", precision: 1 },
  respiratory_rate: { unit: "brpm", label: "Respiratory rate", precision: 1 },
  /** Deviation from the wearer's own baseline, not an absolute temperature. */
  temperature_deviation: { unit: "°C", label: "Skin temp deviation", precision: 2 },
  vo2max: { unit: "ml/kg/min", label: "VO₂ max", precision: 1 },
  weight_kg: { unit: "kg", label: "Weight", precision: 1 },
  body_fat_pct: { unit: "%", label: "Body fat", precision: 1 },

  /* ----------------------------- glucose (CGM) ---------------------------- */
  /*
   * From a continuous glucose monitor, currently Ultrahuman's M1 reported
   * through the same daily endpoint as their ring data.
   *
   * DAILY SUMMARIES, NOT THE TRACE. A CGM produces a reading every few minutes.
   * That belongs in a time-series store, not in a table whose grain is one row
   * per day per metric, and none of the analysis we do needs it: what moves
   * with a lab panel is the day's average, spread and control, not the shape of
   * one afternoon.
   */
  glucose_avg: { unit: "mg/dL", label: "Average glucose", precision: 0 },
  /** Coefficient of variation. How much glucose swings, independent of level. */
  glucose_variability: { unit: "%", label: "Glucose variability", precision: 1 },
  /** Share of the day spent inside the target range. */
  glucose_time_in_target: { unit: "%", label: "Time in target", precision: 0 },
  /**
   * CGM-ESTIMATED HbA1c. NOT the lab value, and never to be shown beside one
   * without saying so.
   *
   * A lab HbA1c measures glycated haemoglobin directly and integrates roughly
   * three months. This is derived from a few weeks of CGM averages, and the two
   * legitimately disagree. Our biomarker catalog already carries a real `hba1c`
   * from blood panels; conflating them would let a device estimate silently
   * overwrite a measured clinical value, which is the single worst thing this
   * integration could do.
   */
  hba1c_estimated: { unit: "%", label: "Estimated HbA1c", precision: 1 },
  /**
   * A vendor's own composite of how the day's glucose behaved. 0-100.
   *
   * UNLIKE EVERY OTHER KEY HERE, THIS ONE IS NOT A QUANTITY. Steps are steps
   * whoever counts them; a metabolic score is one company's formula, and a
   * second vendor's 72 would not mean what Ultrahuman's 72 means. It is kept
   * because it is the one number a CGM user actually looks at daily, and
   * because a score that moves while the underlying average does not is worth
   * seeing. It must never be merged across providers or compared to a lab
   * value: see `biomarker-overlap.ts`.
   */
  metabolic_score: { unit: "score", label: "Metabolic score", precision: 0 },
} as const;

export type MetricKey = keyof typeof METRICS;

/**
 * Metrics that are one vendor's formula rather than a measured quantity.
 *
 * Steps are steps whoever counts them, so "Steps" is an honest label on its
 * own. A metabolic score is not: it is a proprietary composite, and a second
 * vendor's 72 would not mean this vendor's 72. So these are never shown without
 * saying whose they are, and `mergeMetrics` puts the provider in the label
 * rather than leaving it to each chart to remember.
 *
 * Adding a metric here is a labelling decision, not a storage one. The row is
 * stored the same way either way.
 */
export const VENDOR_SPECIFIC: ReadonlySet<MetricKey> = new Set<MetricKey>([
  "metabolic_score",
]);

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export function isMetricKey(k: string): k is MetricKey {
  return Object.prototype.hasOwnProperty.call(METRICS, k);
}

/** One normalized reading, as an adapter emits it. */
export interface DailyMetric {
  metric: MetricKey;
  /** YYYY-MM-DD, the day the metric describes. */
  date: string;
  value: number;
  /** Device or app the vendor attributes it to, when they say. */
  source?: string;
  recordedAt?: string;
}

/**
 * A score is a score, but vendors disagree on the range.
 *
 * Everything in this vocabulary that ends in `_score` is 0-100. An adapter for
 * a vendor that scores 0-10 multiplies; one that scores 0-21 (Whoop's old sleep
 * "performance") rescales. Doing that in the adapter rather than at read time
 * is what lets two providers' scores sit in the same chart without a legend
 * explaining that one of them means something different.
 */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Seconds → whole minutes. The single most common unit mismatch across vendors. */
export function secondsToMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.round(seconds / 60);
}

/**
 * The date a vendor's timestamp belongs to, as a plain day.
 *
 * Sleep is the reason this needs care: a night that starts at 23:40 on the 3rd
 * and ends 07:10 on the 4th is "the 4th's sleep" to every vendor here, because
 * they key a night to the morning you wake. Adapters therefore pass the END of
 * the interval, and this only has to strip the clock, not guess.
 */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}
