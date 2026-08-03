import type { MetricKey } from "./metrics";

/**
 * Where wearable metrics and blood markers describe the same territory.
 *
 * THE NAIVE RULE IS "BLOOD BEATS WEARABLE", AND IT IS WRONG IN AT LEAST ONE
 * PLACE. It is right about HbA1c, where a lab measures glycated haemoglobin
 * directly and a CGM only infers it. It is exactly backwards about average
 * glucose, where our catalog carries `hba1c_eag` derived from lab HbA1c through
 * a population regression, while a CGM measures the same quantity directly
 * thousands of times a day.
 *
 * So the principle is not instrument seniority. It is:
 *
 *   1. PREFER WHATEVER MEASURES THE QUANTITY DIRECTLY. Every other reading of
 *      it is an estimate, however good the instrument that produced it.
 *   2. RESPECT THE PERIOD. HbA1c integrates about three months. A CGM average
 *      covers the days the sensor was actually worn. Two numbers describing
 *      different windows are not in conflict, and treating them as if they were
 *      manufactures a disagreement that does not exist.
 *   3. NEVER MERGE ACROSS INSTRUMENT CLASSES. Same reason `merge.ts` never
 *      averages two devices: a blended number is one nobody measured and nobody
 *      can reconcile against either source.
 *   4. SHOW DISAGREEMENT RATHER THAN RESOLVING IT. When lab-derived eAG and a
 *      CGM average diverge, the gap is the interesting part, not an error to
 *      be smoothed away.
 *
 * This file is a record, not a resolver. Nothing merges these today, and this
 * exists so that whoever first puts a wearable metric next to a blood marker
 * on a chart has to read the rule before they can.
 */

export type Preference =
  /** The blood marker is the direct measurement; the wearable is an estimate. */
  | "biomarker"
  /** The wearable measures it directly; the blood marker is derived. */
  | "wearable"
  /** They are different quantities. Substituting either way is wrong. */
  | "neither";

export interface BiomarkerOverlap {
  /** Key in the wearable vocabulary (`metrics.ts`). */
  wearable: MetricKey;
  /** `marker_key` in the biomarker catalog. */
  biomarker: string;
  prefer: Preference;
  why: string;
}

export const BIOMARKER_OVERLAPS: BiomarkerOverlap[] = [
  {
    wearable: "hba1c_estimated",
    biomarker: "hba1c",
    prefer: "biomarker",
    why:
      "A lab measures glycated haemoglobin directly over roughly three months. " +
      "The CGM figure is inferred from a few weeks of averages. When a lab " +
      "value exists and is current, it is the answer, and the device estimate " +
      "is context at best.",
  },
  {
    wearable: "glucose_avg",
    biomarker: "hba1c_eag",
    prefer: "wearable",
    why:
      "THE ONE THAT INVERTS. `hba1c_eag` is not measured: it is lab HbA1c run " +
      "through a population regression (28.7 x hba1c - 46.7), and individual " +
      "glycation rates vary enough that it can be well off for a given person. " +
      "A CGM measures mean glucose directly, thousands of times a day. For the " +
      "question 'what was your average glucose', the sensor is the better " +
      "answer and the blood-derived figure is the estimate.",
  },
  {
    wearable: "glucose_avg",
    biomarker: "glucose_fasting",
    prefer: "neither",
    why:
      "Same unit, different quantity, which is the trap. Fasting glucose is a " +
      "single timepoint after an overnight fast; a CGM average is a 24-hour " +
      "mean including every meal. Neither is a better version of the other, " +
      "and showing one where a user expects the other is a clinical " +
      "misstatement, not a rounding error.",
  },
  {
    wearable: "metabolic_score",
    biomarker: "hba1c",
    prefer: "neither",
    why:
      "A category error rather than a disagreement. `metabolic_score` is one " +
      "vendor's composite on an arbitrary 0-100 scale; HbA1c is a measured " +
      "quantity with clinical thresholds. The score is worth watching against " +
      "its own history and nothing else, and it is listed here only because " +
      "it sits in the same part of the UI as glucose and invites the " +
      "comparison.",
  },
];

/** The overlaps recorded for one wearable metric, if any. */
export function overlapsFor(metric: MetricKey): BiomarkerOverlap[] {
  return BIOMARKER_OVERLAPS.filter((o) => o.wearable === metric);
}

/**
 * Whether a blood marker should take precedence over a wearable metric.
 *
 * Returns null when they are not comparable at all, which callers must handle
 * as "show both, separately" rather than as "no preference, pick either".
 */
export function preferBiomarker(metric: MetricKey, markerKey: string): boolean | null {
  const overlap = BIOMARKER_OVERLAPS.find(
    (o) => o.wearable === metric && o.biomarker === markerKey,
  );
  if (!overlap) return null;
  if (overlap.prefer === "neither") return null;
  return overlap.prefer === "biomarker";
}
