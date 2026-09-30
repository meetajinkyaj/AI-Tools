/**
 * How a panel's readings are judged and counted.
 *
 * Moved out of biomarker-report.tsx when v2 put "31 of 34 in range" on the Home
 * tile as well as the Report hero. Two screens counting the same panel with two
 * copies of the rule would drift, and a Home tile that says 31 over a report
 * that says 30 is exactly the kind of small wrongness a health app cannot have.
 */

import {
  type Band,
  bandFor,
  type CatalogEntry,
  type Flag,
  isNoteworthy,
  type Severity,
  SEVERITY_LABELS,
  severityFromBand,
} from "./biomarkers";

export interface JudgedReading {
  marker_key: string;
  value: number | null;
  result_kind: string;
  flag: Flag;
}

/** The severity + display label for a reading; the band wins over the raw flag. */
export function readingStatus(
  r: Pick<JudgedReading, "result_kind" | "flag">,
  band: Band | null,
): { severity: Severity; label: string } {
  if (r.result_kind === "qualitative") {
    return r.flag === "in_range"
      ? { severity: "in_range", label: "Normal" }
      : { severity: "high", label: "Review" };
  }
  const severity = severityFromBand(r.flag, band);
  return { severity, label: band ? band.label : SEVERITY_LABELS[severity] };
}

/** The catalog band a reading falls in, if its marker has bands. */
export function bandForReading(
  r: Pick<JudgedReading, "marker_key" | "value">,
  catalogByKey: Map<string, Pick<CatalogEntry, "bands">>,
): Band | null {
  const bands = catalogByKey.get(r.marker_key)?.bands ?? [];
  return r.value != null && bands.length > 0 ? bandFor(r.value, bands) : null;
}

/** Readings worth a look (the report's list), and the in-range count. */
export function summarizePanel<R extends JudgedReading>(
  readings: R[],
  catalog: Pick<CatalogEntry, "marker_key" | "bands">[],
): { worthALook: R[]; inRange: number; total: number } {
  const byKey = new Map(catalog.map((e) => [e.marker_key, e]));
  const worthALook = readings.filter((r) =>
    isNoteworthy(readingStatus(r, bandForReading(r, byKey)).severity),
  );
  return { worthALook, inRange: readings.length - worthALook.length, total: readings.length };
}
