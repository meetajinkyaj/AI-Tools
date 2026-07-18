/**
 * Baseline Biomarker Report domain logic: reference-range flagging, sex-aware
 * catalog selection, and panel-input validation. Pure and dependency-free so it
 * can be unit tested and shared by the API route and the UI. The DB shapes it
 * maps to live in supabase/migrations/0002 & 0004 (biomarker_catalog /
 * _panels / _readings). Supports numeric and qualitative results, multi-band
 * interpretation, derived markers, and lab-provided range overrides.
 */

export const FLAGS = ["in_range", "low", "high", "unknown"] as const;
export type Flag = (typeof FLAGS)[number];

export const FLAG_LABELS: Record<Flag, string> = {
  in_range: "In range",
  low: "Low",
  high: "High",
  unknown: "No range",
};

/**
 * The severity a reading is displayed at. Richer than Flag: a marker with
 * interpretation bands (e.g. LDL "Near optimal") carries the band's severity, so
 * the pill and the callout describe the same thing instead of disagreeing (a
 * blunt "High" pill next to "Near optimal" text). `optimal` is the banded
 * equivalent of `in_range`; `borderline` sits between in-range and out-of-range.
 */
export type Severity = "optimal" | "in_range" | "borderline" | "low" | "high" | "unknown";

export const SEVERITY_LABELS: Record<Severity, string> = {
  optimal: "Optimal",
  in_range: "In range",
  borderline: "Borderline",
  low: "Low",
  high: "High",
  unknown: "No range",
};

/**
 * A reading's effective severity: the band it falls in wins (that's the more
 * precise clinical read), otherwise the numeric in/low/high flag.
 */
export function severityFromBand(flag: Flag, band: Band | null): Severity {
  if (band) {
    const s = band.severity;
    if (s === "optimal" || s === "borderline" || s === "low" || s === "high") {
      return s;
    }
  }
  return flag;
}

/** Whether a severity is worth surfacing in the "worth a look" summary. */
export function isNoteworthy(s: Severity): boolean {
  return s === "low" || s === "high" || s === "borderline";
}

/** A single interpretation band (e.g. Vitamin D "Insufficiency"). */
export interface Band {
  label: string;
  low?: number;
  high?: number;
  severity: string; // 'optimal' | 'borderline' | 'low' | 'high'
}

/** A biomarker_catalog row (one marker, for one sex bucket). */
export interface CatalogEntry {
  marker_key: string;
  display_name: string;
  category: string;
  unit: string;
  sex: string; // 'any' | 'male' | 'female'
  ref_low: number | null;
  ref_high: number | null;
  direction: string; // 'in_range' | 'lower_better' | 'higher_better'
  sort_order: number;
  result_kind: string; // 'numeric' | 'qualitative'
  is_derived: boolean;
  normal_text: string | null; // expected normal for qualitative markers
  bands: Band[];
}

/** Numeric markers the user types in directly (not derived). */
export function isEnterableNumeric(entry: CatalogEntry): boolean {
  return entry.result_kind === "numeric" && !entry.is_derived;
}

/** Qualitative markers (entered as a choice, e.g. Negative / Positive). */
export function isQualitative(entry: CatalogEntry): boolean {
  return entry.result_kind === "qualitative";
}

/** One entered marker value — numeric or qualitative, with an optional range override. */
export interface ReadingInput {
  marker_key: string;
  value: number | null;
  value_text: string | null;
  ref_low: number | null; // lab-provided range override (numeric only)
  ref_high: number | null;
}

export interface PanelInput {
  test_date: string | null; // YYYY-MM-DD
  lab_name: string | null;
  readings: ReadingInput[];
}

const MAX_READINGS = 80;
const MAX_LAB_NAME = 120;

/** Where a value sits relative to its reference range. */
export function computeFlag(
  value: number,
  refLow: number | null,
  refHigh: number | null,
): Flag {
  if (refLow == null && refHigh == null) return "unknown";
  if (refLow != null && value < refLow) return "low";
  if (refHigh != null && value > refHigh) return "high";
  return "in_range";
}

/**
 * Collapse a multi-row catalog (one row per sex bucket) to one entry per
 * marker for the given sex: prefer the sex-specific row, else the 'any' row.
 * Preserves catalog ordering.
 */
export function dedupeCatalogForSex(
  rows: CatalogEntry[],
  sex: string,
): CatalogEntry[] {
  const byKey = new Map<string, CatalogEntry>();
  for (const row of rows) {
    const existing = byKey.get(row.marker_key);
    if (!existing) {
      byKey.set(row.marker_key, row);
      continue;
    }
    // Prefer an exact sex match over 'any'.
    if (row.sex === sex && existing.sex !== sex) {
      byKey.set(row.marker_key, row);
    }
  }
  return [...byKey.values()].sort((a, b) => a.sort_order - b.sort_order);
}

/** Group deduped catalog entries by category, preserving order. */
export function groupByCategory(
  entries: CatalogEntry[],
): { category: string; entries: CatalogEntry[] }[] {
  const groups: { category: string; entries: CatalogEntry[] }[] = [];
  const index = new Map<string, number>();
  for (const e of entries) {
    let i = index.get(e.category);
    if (i === undefined) {
      i = groups.length;
      index.set(e.category, i);
      groups.push({ category: e.category, entries: [] });
    }
    groups[i].entries.push(e);
  }
  return groups;
}

export type ValidationResult =
  | { ok: true; value: PanelInput }
  | { ok: false; error: string };

/**
 * Validate an untrusted panel body. Requires at least one reading with a finite
 * numeric value; test_date/lab_name are optional. Marker-key membership against
 * the catalog is checked by the caller (which holds the catalog). Never throws.
 */
export function validatePanelInput(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  let testDate: string | null = null;
  if (b.test_date !== undefined && b.test_date !== null && b.test_date !== "") {
    if (typeof b.test_date !== "string" || !isValidDate(b.test_date)) {
      return { ok: false, error: "Invalid test date" };
    }
    testDate = b.test_date;
  }

  const labName =
    typeof b.lab_name === "string" && b.lab_name.trim().length > 0
      ? b.lab_name.trim()
      : null;
  if (labName !== null && labName.length > MAX_LAB_NAME) {
    return { ok: false, error: "Lab name is too long" };
  }

  if (!Array.isArray(b.readings) || b.readings.length === 0) {
    return { ok: false, error: "Enter at least one marker value" };
  }
  if (b.readings.length > MAX_READINGS) {
    return { ok: false, error: "Too many markers" };
  }

  const readings: ReadingInput[] = [];
  for (const raw of b.readings) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "Invalid marker entry" };
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.marker_key !== "string" || r.marker_key.length === 0) {
      return { ok: false, error: "Invalid marker" };
    }

    const valueText =
      typeof r.value_text === "string" && r.value_text.trim().length > 0
        ? r.value_text.trim()
        : null;

    let value: number | null = null;
    if (r.value !== undefined && r.value !== null && r.value !== "") {
      const n = typeof r.value === "string" ? Number(r.value) : r.value;
      if (typeof n !== "number" || !Number.isFinite(n)) {
        return { ok: false, error: `Enter a number for ${r.marker_key}` };
      }
      value = n;
    }

    if (value === null && valueText === null) {
      return { ok: false, error: `Enter a value for ${r.marker_key}` };
    }

    const refLow = optionalNumber(r.ref_low);
    const refHigh = optionalNumber(r.ref_high);

    readings.push({
      marker_key: r.marker_key,
      value,
      value_text: valueText,
      ref_low: refLow,
      ref_high: refHigh,
    });
  }

  return { ok: true, value: { test_date: testDate, lab_name: labName, readings } };
}

function optionalNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Flag a qualitative result: matches the expected normal → in_range, else flagged. */
export function qualitativeFlag(
  valueText: string,
  normalText: string | null,
): Flag {
  if (!normalText) return "unknown";
  return valueText.trim().toLowerCase() === normalText.trim().toLowerCase()
    ? "in_range"
    : "high";
}

const ABNORMAL_FOR: Record<string, string> = {
  negative: "Positive",
  "non-reactive": "Reactive",
  "not detected": "Detected",
  absent: "Present",
  normal: "Abnormal",
};

/** The two choices offered for a qualitative marker: [normal, abnormal]. */
export function qualitativeOptions(normalText: string | null): string[] {
  const normal = normalText ?? "Negative";
  const abnormal = ABNORMAL_FOR[normal.trim().toLowerCase()] ?? "Abnormal";
  return [normal, abnormal];
}

/** The band a value falls into (high treated as exclusive), or null. */
export function bandFor(value: number, bands: Band[]): Band | null {
  for (const band of bands) {
    const lo = band.low ?? -Infinity;
    const hi = band.high ?? Infinity;
    if (value >= lo && value < hi) return band;
  }
  return null;
}

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Some labs (e.g. FITTR) report cell counts in raw cells/µL, but our catalog's
 * canonical unit is a scaled unit — 10^3/µL for WBC & platelets, million/µL for
 * RBC. Left as-is, a WBC of 6870 gets compared to a 3.4–10.8 range and flags
 * "high" when it's actually normal (6.87). When a value's magnitude clearly
 * indicates the raw-count unit, scale it to the catalog unit.
 *
 * `threshold` sits well above any plausible canonical value and well below any
 * raw-count value, so the mapping is unambiguous and idempotent — an
 * already-canonical value passes through untouched. To support another marker,
 * add a row here (see docs/REFERENCE_DATA.md).
 */
const COUNT_SCALES: Record<string, { factor: number; threshold: number }> = {
  wbc: { factor: 1000, threshold: 200 }, // canonical ~3–11, raw ~4000–11000
  platelets: { factor: 1000, threshold: 3000 }, // canonical ~150–450, raw ~150000+
  rbc: { factor: 1_000_000, threshold: 100 }, // canonical ~4–6, raw ~4.7M
};

/** Scale a raw cell-count value to the catalog's canonical unit when needed. */
export function canonicalizeCount(markerKey: string, value: number): number {
  const scale = COUNT_SCALES[markerKey];
  if (scale && value >= scale.threshold) return round(value / scale.factor, 2);
  return value;
}

/**
 * Compute the derived markers whose inputs are all present in `entered`
 * (a map of marker_key -> numeric value). Returns { marker_key, value } pairs.
 */
export function computeDerived(
  entered: Map<string, number>,
): { marker_key: string; value: number }[] {
  const out: { marker_key: string; value: number }[] = [];
  const g = (k: string) => entered.get(k);

  const tc = g("total_cholesterol");
  const hdl = g("hdl_c");
  const ldl = g("ldl_c");
  const tg = g("triglycerides");
  const hba1c = g("hba1c");
  const ast = g("ast");
  const alt = g("alt");
  const albumin = g("albumin");
  const globulin = g("globulin");

  if (tc != null && hdl != null) {
    out.push({ marker_key: "non_hdl_c", value: round(tc - hdl) });
    if (hdl > 0) out.push({ marker_key: "tc_hdl_ratio", value: round(tc / hdl, 2) });
  }
  if (tg != null) out.push({ marker_key: "vldl", value: round(tg / 5) });
  if (ldl != null && hdl != null && hdl > 0) {
    out.push({ marker_key: "ldl_hdl_ratio", value: round(ldl / hdl, 2) });
  }
  if (hba1c != null) {
    out.push({ marker_key: "hba1c_eag", value: round(28.7 * hba1c - 46.7) });
  }
  if (ast != null && alt != null && alt > 0) {
    out.push({ marker_key: "ast_alt_ratio", value: round(ast / alt, 2) });
  }
  if (albumin != null && globulin != null && globulin > 0) {
    out.push({ marker_key: "ag_ratio", value: round(albumin / globulin, 2) });
  }
  return out;
}

/** Accepts a real YYYY-MM-DD calendar date that is not in the future. */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return false;
  }
  return date.getTime() <= Date.now();
}
