/**
 * How a device number is written, in one place.
 *
 * TWO SCREENS SHOW THE SAME READING. "From your devices" shows the merged
 * answer; "What your Whoop says" shows what one device sent, unmerged, so that
 * somebody can reconcile our figures against the vendor's own app line by line.
 * That reconciliation is the entire point of the second screen, and it only
 * works if both format a number identically: 6h 48m in one place and 408 min in
 * the other would look like a disagreement about the data rather than about
 * presentation.
 *
 * It used to be two copies of this function with different signatures, one of
 * which derived its decimal places from the unit while the other took them from
 * the API. They agreed for most metrics and not for all of them: a temperature
 * deviation is stored to two places and the unit-derived rule gives it zero, so
 * -0.24 read as "-0" on one screen and "-0.24" on the other.
 */

/** The figure and its unit, kept apart: they are set differently. */
export interface Displayed {
  value: string;
  unit: string;
}

/**
 * How many decimal places a unit implies, when nothing more specific is known.
 *
 * The caller passes `precision` when it has one from the metric vocabulary,
 * which is the better answer; this is the fallback for the merged series, whose
 * API sends the unit but not the precision.
 */
function decimalsFor(unit: string): number {
  return unit === "%" || unit === "kg" || unit === "brpm" ? 1 : 0;
}

export function display(
  metric: string,
  value: number,
  unit: string,
  precision?: number,
): Displayed {
  if (metric === "sleep_minutes") {
    const h = Math.floor(value / 60);
    const m = Math.round(value % 60);
    // Padded, or 6h 5m reads as 6h 50m at a glance.
    return { value: `${h}h ${String(m).padStart(2, "0")}m`, unit: "" };
  }

  const dp = precision ?? decimalsFor(unit);
  // Grouped: a step count is the one number here that routinely runs to five
  // digits, and "12483" is harder to read at a glance than "12,483".
  const n = value.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  // "count" and "score" are descriptions of the number, not units you say out
  // loud: "9,000 count" and "55 score" both read as a bug.
  const bare = unit === "count" || unit === "score";
  return { value: n, unit: bare ? "" : unit };
}
