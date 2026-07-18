/**
 * Lab-PDF → structured-markers extraction: prompt building and response
 * normalization. Pure and dependency-free (no network, no SDK) so it can be
 * unit tested and shared by the API route. The actual model call lives in
 * `anthropic.ts`; this module only *builds the instruction* we send and
 * *normalizes what comes back* against our biomarker catalog.
 *
 * Accuracy strategy (see docs/SCALING.md): the model only reads values off the
 * page and maps them to our catalog keys. It never decides high/low — the
 * deterministic engine in `biomarkers.ts` recomputes every flag afterwards, and
 * the user confirms the draft before anything is saved.
 */

import { type CatalogEntry, isValidDate } from "./biomarkers";

/** One marker the model pulled off the page, normalized to a catalog key. */
export interface ExtractedReading {
  marker_key: string;
  display_name: string;
  category: string;
  unit: string | null; // catalog (canonical) unit
  unit_raw: string | null; // unit exactly as printed on the report
  result_kind: string; // 'numeric' | 'qualitative'
  value: number | null;
  value_raw: number | null; // value exactly as printed (before canonicalization)
  value_text: string | null;
  ref_low: number | null; // lab-printed range, if the PDF showed one
  ref_high: number | null;
}

export interface ExtractionResult {
  test_date: string | null;
  lab_name: string | null;
  readings: ExtractedReading[];
  /** Marker names the model saw but couldn't confidently map to our catalog. */
  unmatched: string[];
}

const MAX_UNMATCHED = 40;
const MAX_LAB_NAME = 120;

/**
 * Build the instruction we send alongside the PDF. We hand the model the exact
 * catalog keys it may use (deduped for the user's sex, minus derived markers,
 * which we compute ourselves) so its output maps 1:1 onto our schema.
 */
export function buildExtractionPrompt(catalog: CatalogEntry[]): string {
  const usable = catalog.filter((e) => !e.is_derived);
  const lines = usable.map((e) => {
    const kind = e.result_kind === "qualitative" ? "qualitative" : "numeric";
    const unit = e.unit ? ` [${e.unit}]` : "";
    const normal =
      e.result_kind === "qualitative" && e.normal_text
        ? ` (normal: ${e.normal_text})`
        : "";
    return `- ${e.marker_key}: ${e.display_name}${unit} — ${kind}${normal}`;
  });

  return [
    "You are a careful medical-lab data extractor. You are given a lab report PDF.",
    "Extract ONLY the biomarker results that map to the catalog below. Do not",
    "invent values, do not compute or infer anything, and do not flag results as",
    "high or low — only transcribe what is printed.",
    "",
    "For each result you find that matches a catalog marker, output the marker_key",
    "from the catalog, the printed value, the printed unit exactly as shown, and —",
    "if the report prints a reference range next to it — that range's low and high",
    "numbers.",
    "  • numeric markers: put the number in `value` (value_text null).",
    "  • qualitative markers (e.g. Negative/Positive): put the printed word in",
    "    `value_text` (value null).",
    "  • `unit`: the unit string exactly as printed (e.g. \"mg/dL\", \"10^3/uL\",",
    "    \"/cumm\"); null if none is printed. Do not convert it.",
    "If a printed lab *result* does not match any catalog marker, add its printed",
    "name to `unmatched` (do not guess a key) — but keep `unmatched` short: at most",
    "10 of the most notable unrecognized results, not every heading or line of text.",
    "If the same marker appears more than once, use the most recent / primary result.",
    "",
    "Also extract the collection/test date (as YYYY-MM-DD) and the lab or provider",
    "name if printed.",
    "",
    "Respond with ONLY a single JSON object, no prose, in exactly this shape:",
    "{",
    '  "test_date": "YYYY-MM-DD" | null,',
    '  "lab_name": string | null,',
    '  "markers": [',
    '    { "marker_key": string, "value": number | null, "value_text": string | null,',
    '      "unit": string | null, "ref_low": number | null, "ref_high": number | null }',
    "  ],",
    '  "unmatched": string[]',
    "}",
    "",
    "Allowed catalog markers:",
    ...lines,
  ].join("\n");
}

/**
 * Pull the first JSON object out of a model response. Tolerates ```json fences
 * and leading/trailing prose. Returns null if no object can be parsed.
 */
export function extractJsonObject(text: string): unknown {
  if (typeof text !== "string") return null;
  // Strip code fences if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toNumberOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Normalize a parsed model object against the catalog. Keeps only markers whose
 * key is a known, non-derived catalog entry; coerces numeric vs qualitative to
 * match the catalog's result_kind; dedupes by marker_key (first wins). Never
 * throws — bad shapes yield an empty result.
 */
export function normalizeExtraction(
  parsed: unknown,
  catalog: CatalogEntry[],
): ExtractionResult {
  const byKey = new Map(catalog.map((e) => [e.marker_key, e]));
  const empty: ExtractionResult = {
    test_date: null,
    lab_name: null,
    readings: [],
    unmatched: [],
  };
  if (typeof parsed !== "object" || parsed === null) return empty;
  const p = parsed as Record<string, unknown>;

  let testDate: string | null = null;
  if (typeof p.test_date === "string" && isValidDate(p.test_date)) {
    testDate = p.test_date;
  }

  let labName: string | null = null;
  if (typeof p.lab_name === "string" && p.lab_name.trim().length > 0) {
    labName = p.lab_name.trim().slice(0, MAX_LAB_NAME);
  }

  const readings: ExtractedReading[] = [];
  const seen = new Set<string>();
  const rawMarkers = Array.isArray(p.markers) ? p.markers : [];
  for (const raw of rawMarkers) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const key = typeof r.marker_key === "string" ? r.marker_key : "";
    const entry = byKey.get(key);
    // Unknown or derived markers are dropped (derived ones are computed later).
    if (!entry || entry.is_derived || seen.has(key)) continue;

    const unitRaw =
      typeof r.unit === "string" && r.unit.trim().length > 0
        ? r.unit.trim().slice(0, 40)
        : null;

    if (entry.result_kind === "qualitative") {
      const text =
        typeof r.value_text === "string" && r.value_text.trim().length > 0
          ? r.value_text.trim()
          : null;
      if (!text) continue;
      readings.push({
        marker_key: key,
        display_name: entry.display_name,
        category: entry.category,
        unit: entry.unit,
        unit_raw: unitRaw,
        result_kind: "qualitative",
        value: null,
        value_raw: null,
        value_text: text,
        ref_low: null,
        ref_high: null,
      });
    } else {
      const value = toNumberOrNull(r.value);
      if (value === null) continue;
      readings.push({
        marker_key: key,
        display_name: entry.display_name,
        category: entry.category,
        unit: entry.unit,
        unit_raw: unitRaw,
        result_kind: "numeric",
        value, // canonicalized by the caller; value_raw preserves the printed value
        value_raw: value,
        value_text: null,
        ref_low: toNumberOrNull(r.ref_low),
        ref_high: toNumberOrNull(r.ref_high),
      });
    }
    seen.add(key);
  }

  const unmatched: string[] = [];
  if (Array.isArray(p.unmatched)) {
    for (const u of p.unmatched) {
      if (typeof u === "string" && u.trim().length > 0) {
        unmatched.push(u.trim().slice(0, 80));
      }
      if (unmatched.length >= MAX_UNMATCHED) break;
    }
  }

  return { test_date: testDate, lab_name: labName, readings, unmatched };
}

/** Parse a raw model response string straight into a normalized result. */
export function parseExtractionResponse(
  text: string,
  catalog: CatalogEntry[],
): ExtractionResult {
  return normalizeExtraction(extractJsonObject(text), catalog);
}

const MIN_TEXT_LAYER_CHARS = 200;

/**
 * Whether an extracted PDF text layer is rich enough to read from directly. A
 * digitally-generated lab report yields thousands of alphanumeric characters; a
 * scanned/image PDF yields almost none, in which case we fall back to sending
 * the PDF itself for vision reading.
 */
export function hasUsableTextLayer(text: string | null | undefined): boolean {
  if (!text) return false;
  const alnum = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  return alnum >= MIN_TEXT_LAYER_CHARS;
}
