/**
 * Baseline Biomarker Report domain logic: reference-range flagging, sex-aware
 * catalog selection, and panel-input validation. Pure and dependency-free so it
 * can be unit tested and shared by the API route and the UI. The DB shapes it
 * maps to live in supabase/migrations/0002 (biomarker_catalog / _panels /
 * _readings).
 *
 * v1 is numeric-only. Qualitative results (e.g. HIV "Non-reactive", urine
 * "Absent") are out of scope here and would need a value_text/result_kind
 * column before they can be stored.
 */

export const FLAGS = ["in_range", "low", "high", "unknown"] as const;
export type Flag = (typeof FLAGS)[number];

export const FLAG_LABELS: Record<Flag, string> = {
  in_range: "In range",
  low: "Low",
  high: "High",
  unknown: "No range",
};

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
}

/** One entered marker value. */
export interface ReadingInput {
  marker_key: string;
  value: number;
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
    const value = typeof r.value === "string" ? Number(r.value) : r.value;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `Enter a number for ${r.marker_key}` };
    }
    readings.push({ marker_key: r.marker_key, value });
  }

  return { ok: true, value: { test_date: testDate, lab_name: labName, readings } };
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
