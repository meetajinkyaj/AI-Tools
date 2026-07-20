"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type Band,
  bandFor,
  type CatalogEntry,
  type Flag,
  groupByCategory,
  isEnterableNumeric,
  isNoteworthy,
  isQualitative,
  qualitativeOptions,
  type Severity,
  SEVERITY_LABELS,
  severityFromBand,
} from "@/lib/biomarkers";
import type { ExtractedReading, ExtractionResult } from "@/lib/extraction";
import { DoctorSummary } from "./doctor-summary";
import {
  Card,
  Eyebrow,
  fieldClass,
  labelClass,
  PageHeader,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

interface ReadingRow {
  id: string;
  marker_key: string;
  marker_name: string;
  value: number | null;
  value_text: string | null;
  result_kind: string;
  unit: string | null;
  reference_range_low: number | null;
  reference_range_high: number | null;
  flag: Flag;
}

interface PanelRow {
  id: string;
  test_date: string | null;
  lab_name: string | null;
  created_at: string;
}

interface ReportData {
  catalog: CatalogEntry[];
  latestPanel: { panel: PanelRow; readings: ReadingRow[] } | null;
}

/** One outcome-verified reward returned by the save route. */
interface OutcomeBonus {
  marker_name: string | null;
  points: number;
}

/** What the user earned by saving a panel — surfaced as a note after saving. */
interface AwardNote {
  pointsAwarded: number;
  bonuses: OutcomeBonus[];
}

type Mode = "report" | "upload" | "review" | "entry";

/** A reading in the shape POST /api/biomarkers expects. */
type SaveReading = {
  marker_key: string;
  value?: number;
  value_text?: string;
  value_raw?: number | null;
  unit_raw?: string | null;
  lab_reference_low?: number | null;
  lab_reference_high?: number | null;
};

/** One row in the confirmation screen — values kept as editable strings. */
interface DraftReading {
  marker_key: string;
  marker_name: string;
  category: string;
  unit: string | null;
  result_kind: string;
  value: string;
  value_text: string;
  // Raw-as-printed provenance carried from extraction (not edited).
  value_raw: number | null;
  unit_raw: string | null;
  lab_reference_low: number | null;
  lab_reference_high: number | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  lipids: "Lipids",
  metabolic: "Metabolic",
  inflammation: "Inflammation",
  cardiac: "Cardiac",
  hematology: "Hematology & iron",
  thyroid: "Thyroid",
  hormones: "Hormones",
  nutrients: "Vitamins & minerals",
  liver: "Liver",
  kidney: "Kidney & electrolytes",
  pancreas: "Pancreas",
  autoimmune: "Autoimmune",
  screening: "Screening",
  urine: "Urine",
};

function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}

function rangeText(low: number | null, high: number | null, unit: string | null): string {
  const u = unit ? ` ${unit}` : "";
  if (low != null && high != null) return `${low}–${high}${u}`;
  if (low != null) return `≥ ${low}${u}`;
  if (high != null) return `≤ ${high}${u}`;
  return "—";
}

/** A status chip coloured by severity: strong for low/high, soft for borderline. */
function StatusPill({ severity, label }: { severity: Severity; label: string }) {
  const cls =
    severity === "low" || severity === "high"
      ? "bg-accent/10 text-accent"
      : severity === "borderline"
        ? "bg-clay/10 text-clay"
        : "bg-surface-2 text-muted";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 font-body text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

/** The severity + display label for a reading — the band wins over the raw flag. */
function readingStatus(
  r: ReadingRow,
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

/** A short, educational line for an out-of-range reading (numeric or qualitative). */
function calloutText(r: ReadingRow, band: Band | null): string {
  if (r.result_kind === "qualitative") {
    return `came back ${r.value_text} — worth confirming with your doctor.`;
  }
  const at = `at ${r.value}${r.unit ? ` ${r.unit}` : ""}`;
  if (band) {
    return `is in the ${band.label} range (${at}).`;
  }
  const dir = r.flag === "low" ? "below" : "above";
  return `is ${dir} the typical range (${rangeText(
    r.reference_range_low,
    r.reference_range_high,
    r.unit,
  )}) ${at}.`;
}

const DISCLAIMER = "Educational, not a diagnosis — please consult a doctor.";

/**
 * The extract endpoint streams newline heartbeats then a final JSON line. Parse
 * the last non-empty line as JSON (also handles a plain single-line JSON body).
 */
function parseStreamedResult(
  raw: string,
): (ExtractionResult & { error?: string }) | null {
  const lines = raw.split("\n").map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    try {
      return JSON.parse(lines[i]) as ExtractionResult & { error?: string };
    } catch {
      return null;
    }
  }
  return null;
}

/** Map a normalized extraction result into editable draft rows. */
function toDraftReadings(readings: ExtractedReading[]): DraftReading[] {
  return readings.map((r) => ({
    marker_key: r.marker_key,
    marker_name: r.display_name,
    category: r.category,
    unit: r.unit,
    result_kind: r.result_kind,
    value: r.value != null ? String(r.value) : "",
    value_text: r.value_text ?? "",
    value_raw: r.value_raw,
    unit_raw: r.unit_raw,
    lab_reference_low: r.ref_low,
    lab_reference_high: r.ref_high,
  }));
}

/** Group any keyed rows by category, ordered by CATEGORY_LABELS then extras. */
function groupByCategoryOrder<T extends { category: string }>(
  rows: T[],
): { category: string; rows: T[] }[] {
  const order = Object.keys(CATEGORY_LABELS);
  const byCat = new Map<string, T[]>();
  for (const r of rows) {
    const list = byCat.get(r.category) ?? [];
    list.push(r);
    byCat.set(r.category, list);
  }
  const groups: { category: string; rows: T[] }[] = [];
  for (const cat of order) {
    const list = byCat.get(cat);
    if (list) groups.push({ category: cat, rows: list });
  }
  for (const [cat, list] of byCat) {
    if (!order.includes(cat)) groups.push({ category: cat, rows: list });
  }
  return groups;
}

export function BiomarkerReport({
  getToken,
  onExploreRewards,
}: {
  getToken: () => Promise<string | null>;
  /** Navigate to the Partners/redemption tab (from the "you earned" note). */
  onExploreRewards?: () => void;
}) {
  const [data, setData] = useState<ReportData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mode, setMode] = useState<Mode>("report");
  const [showSummary, setShowSummary] = useState(false);
  const [awardNote, setAwardNote] = useState<AwardNote | null>(null);
  // The full per-marker breakdown is heavy; keep it collapsed so the report
  // leads with what needs attention and reveals the rest on demand.
  const [showAll, setShowAll] = useState(false);

  // Manual-entry state (fallback path).
  const [values, setValues] = useState<Record<string, string>>({});
  const [qualValues, setQualValues] = useState<Record<string, string>>({});
  const [testDate, setTestDate] = useState("");
  const [labName, setLabName] = useState("");

  // Upload / review (primary path) state.
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [draft, setDraft] = useState<DraftReading[]>([]);
  const [draftDate, setDraftDate] = useState("");
  const [draftLab, setDraftLab] = useState("");
  const [unmatched, setUnmatched] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      if (!token) return setStatus("error");
      const res = await fetch("/api/biomarkers", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return setStatus("error");
      const d = (await res.json()) as ReportData;
      setData(d);
      setMode(d.latestPanel ? "report" : "upload");
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load report:", err);
      setStatus("error");
    }
  }, [getToken]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  /** Persist a set of readings and swap to the report view on success. */
  async function saveReadings(
    readings: SaveReading[],
    source: "manual" | "pdf",
    meta: { test_date: string; lab_name: string },
  ): Promise<boolean> {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("You're not signed in. Please reload and try again.");
        return false;
      }
      const res = await fetch("/api/biomarkers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          test_date: meta.test_date || null,
          lab_name: meta.lab_name || null,
          source,
          readings,
        }),
      });
      const result = (await res.json()) as {
        panel?: PanelRow;
        readings?: ReadingRow[];
        bonuses?: OutcomeBonus[];
        pointsAwarded?: number;
        error?: string;
      };
      if (!res.ok || !result.panel || !result.readings) {
        setError(result.error ?? "Something went wrong. Please try again.");
        return false;
      }
      setData((prev) => ({
        catalog: prev?.catalog ?? [],
        latestPanel: { panel: result.panel!, readings: result.readings! },
      }));
      setAwardNote(
        result.pointsAwarded && result.pointsAwarded > 0
          ? { pointsAwarded: result.pointsAwarded, bonuses: result.bonuses ?? [] }
          : null,
      );
      setMode("report");
      return true;
    } catch (err) {
      console.error("Report save failed:", err);
      setError("Something went wrong. Please try again.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExtract(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a PDF of your lab report first.");
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("You're not signed in. Please reload and try again.");
        return;
      }
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/biomarkers/extract", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      // Validation errors come back as a normal JSON error response; a 200 is a
      // heartbeat-padded stream whose last non-empty line is the JSON payload.
      const raw = await res.text();
      const result = parseStreamedResult(raw);
      if (!res.ok || !result || result.error || !result.readings) {
        setError(result?.error ?? "We couldn't read that PDF. Please try again.");
        return;
      }
      setDraft(toDraftReadings(result.readings));
      setDraftDate(result.test_date ?? "");
      setDraftLab(result.lab_name ?? "");
      setUnmatched(result.unmatched ?? []);
      setMode("review");
    } catch (err) {
      console.error("Extraction failed:", err);
      setError("We couldn't read that PDF. Please try again.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSaveDraft(event: React.FormEvent) {
    event.preventDefault();
    const readings = draft
      .map((d): SaveReading | null => {
        if (d.result_kind === "qualitative") {
          return d.value_text.trim() !== ""
            ? { marker_key: d.marker_key, value_text: d.value_text, unit_raw: d.unit_raw }
            : null;
        }
        const n = Number(d.value.trim());
        return d.value.trim() !== "" && Number.isFinite(n)
          ? {
              marker_key: d.marker_key,
              value: n,
              value_raw: d.value_raw,
              unit_raw: d.unit_raw,
              lab_reference_low: d.lab_reference_low,
              lab_reference_high: d.lab_reference_high,
            }
          : null;
      })
      .filter((r): r is SaveReading => r !== null);

    if (readings.length === 0) {
      setError("Add at least one value before saving.");
      return;
    }
    await saveReadings(readings, "pdf", { test_date: draftDate, lab_name: draftLab });
  }

  async function handleManualSubmit(event: React.FormEvent) {
    event.preventDefault();
    const numericReadings = Object.entries(values)
      .map(([marker_key, v]) => ({ marker_key, v: v.trim() }))
      .filter((r) => r.v !== "" && Number.isFinite(Number(r.v)))
      .map((r) => ({ marker_key: r.marker_key, value: Number(r.v) }));

    const qualReadings = Object.entries(qualValues)
      .filter(([, v]) => v !== "")
      .map(([marker_key, value_text]) => ({ marker_key, value_text }));

    const readings = [...numericReadings, ...qualReadings];
    if (readings.length === 0) {
      setError("Enter at least one marker value.");
      return;
    }
    const ok = await saveReadings(readings, "manual", {
      test_date: testDate,
      lab_name: labName,
    });
    if (ok) {
      setValues({});
      setQualValues({});
      setTestDate("");
      setLabName("");
    }
  }

  if (status === "loading") {
    return <p className="font-body text-sm text-muted">Loading your report…</p>;
  }
  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-body text-sm text-muted">Couldn&rsquo;t load your report.</p>
        <button onClick={() => void load()} className={primaryButtonClass}>
          Try again
        </button>
      </div>
    );
  }

  const catalog = data?.catalog ?? [];
  const latestPanel = data?.latestPanel ?? null;
  const catalogByKey = new Map(catalog.map((e) => [e.marker_key, e]));

  // ---------------------------------------------------------------- Upload
  if (mode === "upload") {
    return (
      <div className="flex w-full max-w-xl flex-col gap-6">
        <PageHeader
          eyebrow="Report"
          title="Upload your lab report"
          subtitle="Drop in the PDF from your blood test. We'll read the values, you confirm them — no typing required."
        />

        <form onSubmit={handleExtract} className="flex flex-col gap-5">
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border-strong bg-surface px-6 py-10 text-center transition-colors hover:bg-surface-2"
          >
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
            />
            <span className="font-body text-sm font-medium text-foreground">
              {file ? file.name : "Choose a PDF"}
            </span>
            <span className="font-body text-xs text-muted">
              {file ? "Tap to pick a different file" : "PDF up to 15 MB"}
            </span>
          </label>

          {error && <p className="font-body text-sm text-accent-hover">{error}</p>}

          <p className="font-body text-xs text-muted">{DISCLAIMER}</p>

          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={extracting || !file}
              className={`${primaryButtonClass} w-full sm:flex-1`}
            >
              {extracting ? "Reading your report…" : "Read my report"}
            </button>
            {latestPanel && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode("report");
                }}
                disabled={extracting}
                className={`${secondaryButtonClass} w-full sm:flex-1`}
              >
                Cancel
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode("entry");
            }}
            className="self-center font-body text-xs text-muted underline underline-offset-4 hover:text-foreground"
          >
            Or enter values manually
          </button>
        </form>
      </div>
    );
  }

  // ---------------------------------------------------------------- Review
  if (mode === "review") {
    const groups = groupByCategoryOrder(draft);
    const update = (key: string, patch: Partial<DraftReading>) =>
      setDraft((prev) =>
        prev.map((d) => (d.marker_key === key ? { ...d, ...patch } : d)),
      );
    const remove = (key: string) =>
      setDraft((prev) => prev.filter((d) => d.marker_key !== key));

    return (
      <div className="flex w-full max-w-xl flex-col gap-6">
        <PageHeader
          eyebrow="Report"
          title="Check your results"
          subtitle="We read these from your PDF. Fix anything that looks off, then save."
        />

        <form onSubmit={handleSaveDraft} className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Test date
              <input
                className={fieldClass}
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={draftDate}
                onChange={(e) => setDraftDate(e.target.value)}
              />
            </label>
            <label className={labelClass}>
              Lab name
              <input
                className={fieldClass}
                value={draftLab}
                onChange={(e) => setDraftLab(e.target.value)}
                maxLength={120}
                placeholder="e.g. FITTR"
              />
            </label>
          </div>

          {draft.length === 0 && (
            <p className="font-body text-sm text-muted">
              No markers left. Re-upload your report or enter values manually.
            </p>
          )}

          {groups.map((group) => (
            <div key={group.category} className="flex flex-col gap-3">
              <Eyebrow>{categoryLabel(group.category)}</Eyebrow>
              <div className="flex flex-col gap-2">
                {group.rows.map((d) => {
                  const entry = catalogByKey.get(d.marker_key);
                  const qualitative = d.result_kind === "qualitative";
                  return (
                    <div
                      key={d.marker_key}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-body text-sm text-foreground">
                          {d.marker_name}
                        </span>
                        {!qualitative && (
                          <span className="font-body text-xs text-muted">
                            {rangeText(entry?.ref_low ?? null, entry?.ref_high ?? null, d.unit)}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {qualitative ? (
                          <select
                            className={`${fieldClass} w-36`}
                            value={d.value_text}
                            onChange={(e) =>
                              update(d.marker_key, { value_text: e.target.value })
                            }
                          >
                            <option value="">—</option>
                            {qualitativeOptions(entry?.normal_text ?? null).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className={`${fieldClass} w-24`}
                            type="number"
                            inputMode="decimal"
                            step="any"
                            value={d.value}
                            onChange={(e) =>
                              update(d.marker_key, { value: e.target.value })
                            }
                            placeholder={d.unit ?? ""}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => remove(d.marker_key)}
                          aria-label={`Remove ${d.marker_name}`}
                          className="shrink-0 rounded-full px-2 py-1 font-body text-xs text-muted hover:text-accent"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {unmatched.length > 0 && (
            <Card className="flex flex-col gap-1 p-4">
              <Eyebrow>Not matched</Eyebrow>
              <p className="font-body text-xs text-muted">
                We saw these on your report but don&rsquo;t track them yet:{" "}
                {unmatched.join(", ")}.
              </p>
            </Card>
          )}

          {error && <p className="font-body text-sm text-accent-hover">{error}</p>}

          <p className="font-body text-xs text-muted">{DISCLAIMER}</p>

          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={submitting || draft.length === 0}
              className={`${primaryButtonClass} w-full sm:flex-1`}
            >
              {submitting ? "Saving…" : "Save report"}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setFile(null);
                setMode("upload");
              }}
              disabled={submitting}
              className={`${secondaryButtonClass} w-full sm:flex-1`}
            >
              Re-upload
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ------------------------------------------------------- Manual entry (fallback)
  if (mode === "entry") {
    const groups = groupByCategory(catalog.filter(isEnterableNumeric));
    const qualGroups = groupByCategory(catalog.filter(isQualitative));
    return (
      <div className="flex w-full max-w-xl flex-col gap-6">
        <PageHeader
          eyebrow="Report"
          title="Enter your blood panel"
          subtitle="Type the markers you have — leave the rest blank. We'll flag anything outside its typical range."
        />

        <form onSubmit={handleManualSubmit} className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Test date
              <input
                className={fieldClass}
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={testDate}
                onChange={(e) => setTestDate(e.target.value)}
              />
            </label>
            <label className={labelClass}>
              Lab name
              <input
                className={fieldClass}
                value={labName}
                onChange={(e) => setLabName(e.target.value)}
                maxLength={120}
                placeholder="e.g. FITTR"
              />
            </label>
          </div>

          {groups.map((group) => (
            <div key={group.category} className="flex flex-col gap-3">
              <Eyebrow>{categoryLabel(group.category)}</Eyebrow>
              <div className="flex flex-col gap-2">
                {group.entries.map((entry) => (
                  <div
                    key={entry.marker_key}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-body text-sm text-foreground">
                        {entry.display_name}
                      </span>
                      <span className="font-body text-xs text-muted">
                        {rangeText(entry.ref_low, entry.ref_high, entry.unit)}
                      </span>
                    </div>
                    <input
                      className={`${fieldClass} w-28 shrink-0`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      value={values[entry.marker_key] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({
                          ...prev,
                          [entry.marker_key]: e.target.value,
                        }))
                      }
                      placeholder={entry.unit ?? ""}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {qualGroups.map((group) => (
            <div key={group.category} className="flex flex-col gap-3">
              <Eyebrow>{categoryLabel(group.category)}</Eyebrow>
              <div className="flex flex-col gap-2">
                {group.entries.map((entry) => (
                  <div
                    key={entry.marker_key}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0 truncate font-body text-sm text-foreground">
                      {entry.display_name}
                    </span>
                    <select
                      className={`${fieldClass} w-36 shrink-0`}
                      value={qualValues[entry.marker_key] ?? ""}
                      onChange={(e) =>
                        setQualValues((prev) => ({
                          ...prev,
                          [entry.marker_key]: e.target.value,
                        }))
                      }
                    >
                      <option value="">—</option>
                      {qualitativeOptions(entry.normal_text).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {error && <p className="font-body text-sm text-accent-hover">{error}</p>}

          <p className="font-body text-xs text-muted">{DISCLAIMER}</p>

          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={submitting}
              className={`${primaryButtonClass} w-full sm:flex-1`}
            >
              {submitting ? "Saving…" : "Generate report"}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("upload");
              }}
              disabled={submitting}
              className={`${secondaryButtonClass} w-full sm:flex-1`}
            >
              Back to upload
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ------------------------------------------------------------- Report view
  const readings = latestPanel?.readings ?? [];
  const categoryByKey = new Map(catalog.map((e) => [e.marker_key, e.category]));
  const readingGroups = groupReadings(readings, categoryByKey);
  const bandOf = (r: ReadingRow): Band | null => {
    const bands = catalogByKey.get(r.marker_key)?.bands ?? [];
    return r.value != null && bands.length > 0 ? bandFor(r.value, bands) : null;
  };
  const outOfRange = readings.filter((r) =>
    isNoteworthy(readingStatus(r, bandOf(r)).severity),
  );
  const inRangeCount = readings.length - outOfRange.length;

  if (showSummary) {
    return <DoctorSummary getToken={getToken} onBack={() => setShowSummary(false)} />;
  }

  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          eyebrow="Report"
          title="Your baseline"
          subtitle={panelSubtitle(latestPanel?.panel)}
        />
        <div className="flex shrink-0 flex-col gap-2">
          <button
            onClick={() => {
              setError(null);
              setFile(null);
              setMode("upload");
            }}
            className={secondaryButtonClass}
          >
            Add panel
          </button>
          <button onClick={() => setShowSummary(true)} className={secondaryButtonClass}>
            For your doctor
          </button>
        </div>
      </div>

      {awardNote && (
        <Card className="flex flex-col gap-4 border-accent/20 bg-accent/5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <Eyebrow>You earned</Eyebrow>
              <p className="font-display text-2xl font-medium text-foreground">
                +{awardNote.pointsAwarded}
                <span className="ml-2 font-body text-sm text-muted">iki points</span>
              </p>
              {awardNote.bonuses.length > 0 && (
                <p className="font-body text-xs text-muted">
                  Includes an improvement bonus for{" "}
                  {awardNote.bonuses
                    .map((b) => b.marker_name)
                    .filter((n): n is string => !!n)
                    .join(", ")}
                  . Keep the streak going.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAwardNote(null)}
              aria-label="Dismiss"
              className="shrink-0 rounded-full px-2 py-1 font-body text-xs text-muted hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
          <div className="flex flex-col gap-3 border-t border-accent/15 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-body text-sm text-foreground/80">
              Spend them with our Partners, or keep accumulating for better
              redemptions.
            </p>
            {onExploreRewards && (
              <button
                type="button"
                onClick={onExploreRewards}
                className={`${secondaryButtonClass} shrink-0`}
              >
                Explore Partners
              </button>
            )}
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-1 p-6">
        <Eyebrow>Summary</Eyebrow>
        {outOfRange.length > 0 ? (
          <>
            <p className="font-display text-2xl font-medium text-foreground">
              {outOfRange.length} of {readings.length}
              <span className="ml-2 font-body text-sm text-muted">
                {outOfRange.length === 1 ? "marker" : "markers"} to review
              </span>
            </p>
            {inRangeCount > 0 && (
              <p className="font-body text-sm text-muted">
                The other {inRangeCount} are in a healthy range.
              </p>
            )}
          </>
        ) : (
          <p className="font-display text-2xl font-medium text-foreground">
            All {readings.length} in range
            <span className="ml-2 font-body text-sm text-muted">nothing to review</span>
          </p>
        )}
      </Card>

      {outOfRange.length > 0 && (
        <Card className="flex flex-col gap-3 p-6">
          <Eyebrow>Worth a look</Eyebrow>
          <ul className="flex flex-col gap-2">
            {outOfRange.map((r) => (
              <li key={r.id} className="font-body text-sm text-foreground/80">
                <span className="font-medium text-foreground">{r.marker_name}</span>{" "}
                {calloutText(r, bandOf(r))}
              </li>
            ))}
          </ul>
          <p className="font-body text-xs text-muted">
            General information, not a diagnosis — worth discussing with a
            qualified professional.
          </p>
        </Card>
      )}

      {readings.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className={`${secondaryButtonClass} w-full justify-center`}
        >
          {showAll
            ? "Hide the full breakdown"
            : `See all ${readings.length} markers in detail`}
        </button>
      )}

      {showAll &&
        readingGroups.map((group) => (
          <Card key={group.category} className="flex flex-col divide-y divide-border">
            <div className="px-5 pt-4 pb-2">
              <Eyebrow>{categoryLabel(group.category)}</Eyebrow>
            </div>
            {group.readings.map((r) => {
              const qualitative = r.result_kind === "qualitative";
              const status = readingStatus(r, bandOf(r));
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-body text-sm text-foreground">
                      {r.marker_name}
                    </span>
                    <span className="font-body text-xs text-muted">
                      {qualitative
                        ? "Screening"
                        : rangeText(r.reference_range_low, r.reference_range_high, r.unit)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-body text-sm font-medium text-foreground">
                      {qualitative ? (
                        r.value_text
                      ) : (
                        <>
                          {r.value}
                          {r.unit ? (
                            <span className="ml-1 text-xs font-normal text-muted">
                              {r.unit}
                            </span>
                          ) : null}
                        </>
                      )}
                    </span>
                    <StatusPill severity={status.severity} label={status.label} />
                  </div>
                </div>
              );
            })}
          </Card>
        ))}

      <p className="font-body text-xs text-muted">{DISCLAIMER}</p>
    </div>
  );
}

function panelSubtitle(panel: PanelRow | undefined): string {
  if (!panel) return "";
  const parts: string[] = [];
  if (panel.test_date) parts.push(panel.test_date);
  if (panel.lab_name) parts.push(panel.lab_name);
  return parts.length > 0 ? parts.join(" · ") : "Your latest panel";
}

/**
 * Group readings by category (from the catalog), ordered by CATEGORY_LABELS with
 * any unknown categories appended.
 */
function groupReadings(
  readings: ReadingRow[],
  categoryByKey: Map<string, string>,
): { category: string; readings: ReadingRow[] }[] {
  const order = Object.keys(CATEGORY_LABELS);
  const byCategory = new Map<string, ReadingRow[]>();
  for (const r of readings) {
    const cat = categoryByKey.get(r.marker_key) ?? "other";
    const list = byCategory.get(cat) ?? [];
    list.push(r);
    byCategory.set(cat, list);
  }
  const groups: { category: string; readings: ReadingRow[] }[] = [];
  for (const cat of order) {
    const list = byCategory.get(cat);
    if (list) groups.push({ category: cat, readings: list });
  }
  for (const [cat, list] of byCategory) {
    if (!order.includes(cat)) groups.push({ category: cat, readings: list });
  }
  return groups;
}
