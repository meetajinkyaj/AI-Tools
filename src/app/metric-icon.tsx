/**
 * A glyph per device metric.
 *
 * WHY AT ALL. Six rows that each begin with a line of text at the same size and
 * colour read as a paragraph, not as six separate readings; the eye has nothing
 * to land on and has to read every label to find the one it wants. An icon at
 * the head of each row is what lets somebody find their sleep without reading
 * their heart rate, which is the whole difference between the old list and a
 * dashboard.
 *
 * BY FAMILY, NOT BY KEY. There are twenty-odd metric keys and there will be
 * more, and a bespoke glyph for "glucose variability" next to one for "average
 * glucose" is a distinction nobody needs at 20px. Keys are grouped onto the
 * thing being measured: blood, breath, heart, sleep, the body itself.
 *
 * Drawn here for the same reason `activity-icon.tsx` is: this app ships to a
 * Worker, and an icon package to draw ten glyphs is a dependency for pixels
 * forty lines already reach. Same 24px box, same 1.7 stroke, `currentColor`.
 */

/** The glyph families, and the paths that draw them. */
const GLYPHS: Record<string, string[]> = {
  /** A crescent. Sleep, and anything scored out of a night. */
  moon: ["M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"],

  /** A heart, for the rate it beats at rest. */
  heart: [
    "M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3Z",
  ],

  /** A trace, for the variability between beats. */
  pulse: ["M2 12h4l2.5-6 3.5 12 3-9 2 3h5"],

  /**
   * A breath: one slow wave.
   *
   * The first attempt here was a pair of lungs, which is the obvious picture
   * and is unreadable at 18px: five strokes inside a 24px box collapse into a
   * dark blob that reads as a smudge rather than an organ. A wave survives the
   * size, and next to the spiky `pulse` trace it is clearly a different thing.
   */
  breath: ["M3 12c2.2-5 4.4-5 6.6 0s4.4 5 6.6 0 3.3-2.5 4.8-1"],

  /** Lungs, simplified to three strokes, for the volume behind VO2 max. */
  lungs: [
    "M12 3v9",
    "M12 12H8.6A3.6 3.6 0 0 0 5 15.6V18a2 2 0 0 0 2 2h2a3 3 0 0 0 3-3Z",
    "M12 12h3.4a3.6 3.6 0 0 1 3.6 3.6V18a2 2 0 0 1-2 2h-2a3 3 0 0 1-3-3Z",
  ],

  /** A drop, for anything read out of blood: oxygen, glucose. */
  drop: ["M12 3.5 6.8 10.4a6.4 6.4 0 1 0 10.4 0Z"],

  /** A footprint, for steps. */
  step: [
    "M7.5 13.5c-1.6 0-2.5-1.6-2.5-4.5S6 2.5 7.8 2.5s2.7 2.4 2.7 5.5-1.4 5.5-3 5.5Z",
    "M6 16.5h3.6a1.6 1.6 0 0 1 1.6 1.9l-.3 1.6a1.6 1.6 0 0 1-1.6 1.5H7.3a1.6 1.6 0 0 1-1.6-1.4l-.2-1.6A1.6 1.6 0 0 1 6 16.5Z",
    "M17 20.5c-1.2 0-2-1.2-2-3s.8-3.5 2.2-3.5 2 1.6 2 3.4-1 3.1-2.2 3.1Z",
  ],

  /** A flame, for energy spent. */
  flame: [
    "M12 21c3.3 0 6-2.4 6-5.5 0-3.8-3.5-5.6-3.5-9.5 0 0-2.2 1.3-2.8 4C11 8 10.5 6.5 9.5 5.5 8.7 7.3 6 8.7 6 12.5 6 16.4 8.7 21 12 21Z",
    "M12 21c-1.4 0-2.5-1.1-2.5-2.6 0-1.7 1.6-2.4 1.6-4.4 1 .7 1.7 1.6 2 2.6.4-.5.6-1 .7-1.6.8.9 1.2 2 1.2 3.2A2.7 2.7 0 0 1 12 21Z",
  ],

  /** A gauge, for a vendor's composite score out of 100. */
  gauge: ["M4.5 17a8.5 8.5 0 1 1 15 0", "M12 17l4-5"],

  /** A thermometer, for temperature deviation. */
  thermometer: [
    "M12 14.8V4.5a2 2 0 0 1 4 0v10.3a4 4 0 1 1-4 0Z",
    "M8 7h2",
    "M8 11h2",
  ],

  /** A figure on a scale, for weight and composition. */
  scale: [
    "M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z",
    "M9 10h6",
    "M12 10v4",
  ],
};

/**
 * Which glyph a metric key gets.
 *
 * An unmapped key falls through to the gauge rather than to nothing: a new
 * metric should look like a reading with an unremarkable icon, not like a row
 * whose image failed to load.
 */
const BY_METRIC: Record<string, keyof typeof GLYPHS> = {
  sleep_minutes: "moon",
  sleep_score: "moon",
  resting_heart_rate: "heart",
  hrv: "pulse",
  respiratory_rate: "breath",
  vo2max: "lungs",
  spo2: "drop",
  glucose_avg: "drop",
  glucose_variability: "drop",
  glucose_time_in_target: "drop",
  hba1c_estimated: "drop",
  steps: "step",
  active_calories: "flame",
  readiness_score: "gauge",
  metabolic_score: "gauge",
  stress_high_minutes: "pulse",
  recovery_high_minutes: "moon",
  temperature_deviation: "thermometer",
  weight_kg: "scale",
  body_fat_pct: "scale",
  vascular_age: "heart",
};

export function MetricIcon({
  metric,
  size = 18,
  className = "",
}: {
  metric: string;
  size?: number;
  className?: string;
}) {
  const paths = GLYPHS[BY_METRIC[metric] ?? "gauge"];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Exported for the test that keeps the map and the vocabulary in step. */
export const METRIC_GLYPHS = BY_METRIC;
