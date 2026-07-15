"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type CatalogEntry,
  type Flag,
  FLAG_LABELS,
  groupByCategory,
  isEnterableNumeric,
} from "@/lib/biomarkers";
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
  value: number;
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

function FlagPill({ flag }: { flag: Flag }) {
  const cls =
    flag === "in_range"
      ? "bg-surface-2 text-muted"
      : flag === "unknown"
        ? "bg-surface-2 text-muted"
        : "bg-accent/10 text-accent";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 font-body text-xs font-medium ${cls}`}
    >
      {FLAG_LABELS[flag]}
    </span>
  );
}

const DISCLAIMER = "Educational, not a diagnosis — please consult a doctor.";

export function BiomarkerReport({
  getToken,
}: {
  getToken: () => Promise<string | null>;
}) {
  const [data, setData] = useState<ReportData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mode, setMode] = useState<"report" | "entry">("report");
  const [values, setValues] = useState<Record<string, string>>({});
  const [testDate, setTestDate] = useState("");
  const [labName, setLabName] = useState("");
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
      setMode(d.latestPanel ? "report" : "entry");
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const readings = Object.entries(values)
      .map(([marker_key, v]) => ({ marker_key, v: v.trim() }))
      .filter((r) => r.v !== "" && Number.isFinite(Number(r.v)))
      .map((r) => ({ marker_key: r.marker_key, value: Number(r.v) }));

    if (readings.length === 0) {
      setError("Enter at least one marker value.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("You're not signed in. Please reload and try again.");
        return;
      }
      const res = await fetch("/api/biomarkers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          test_date: testDate || null,
          lab_name: labName || null,
          readings,
        }),
      });
      const result = (await res.json()) as {
        panel?: PanelRow;
        readings?: ReadingRow[];
        error?: string;
      };
      if (!res.ok || !result.panel || !result.readings) {
        setError(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      setData((prev) => ({
        catalog: prev?.catalog ?? [],
        latestPanel: { panel: result.panel!, readings: result.readings! },
      }));
      setValues({});
      setTestDate("");
      setLabName("");
      setMode("report");
    } catch (err) {
      console.error("Report submit failed:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
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

  // ---------------------------------------------------------------- Entry form
  if (mode === "entry") {
    // Only numeric, non-derived markers are typed here; qualitative and derived
    // markers are handled in the report v2 work.
    const groups = groupByCategory(catalog.filter(isEnterableNumeric));
    return (
      <div className="flex w-full max-w-xl flex-col gap-6">
        <PageHeader
          eyebrow="Report"
          title="Add your blood panel"
          subtitle="Enter the markers you have — leave the rest blank. We'll flag anything outside its typical range."
        />

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
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
            {latestPanel && (
              <button
                type="button"
                onClick={() => setMode("report")}
                disabled={submitting}
                className={`${secondaryButtonClass} w-full sm:flex-1`}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  // ------------------------------------------------------------- Report view
  const readings = latestPanel?.readings ?? [];
  const outOfRange = readings.filter((r) => r.flag === "low" || r.flag === "high");
  const categoryByKey = new Map(catalog.map((e) => [e.marker_key, e.category]));
  const readingGroups = groupReadings(readings, categoryByKey);

  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          eyebrow="Report"
          title="Your baseline"
          subtitle={panelSubtitle(latestPanel?.panel)}
        />
        <button
          onClick={() => setMode("entry")}
          className={`${secondaryButtonClass} shrink-0`}
        >
          Add panel
        </button>
      </div>

      <Card className="flex flex-col gap-1 p-6">
        <Eyebrow>Summary</Eyebrow>
        <p className="font-display text-2xl font-medium text-foreground">
          {outOfRange.length} of {readings.length}
          <span className="ml-2 font-body text-sm text-muted">
            {outOfRange.length === 1 ? "marker" : "markers"} outside range
          </span>
        </p>
      </Card>

      {outOfRange.length > 0 && (
        <Card className="flex flex-col gap-3 p-6">
          <Eyebrow>Worth a look</Eyebrow>
          <ul className="flex flex-col gap-2">
            {outOfRange.map((r) => (
              <li key={r.id} className="font-body text-sm text-foreground/80">
                <span className="font-medium text-foreground">{r.marker_name}</span>{" "}
                is {r.flag === "low" ? "below" : "above"} the typical range (
                {rangeText(r.reference_range_low, r.reference_range_high, r.unit)}) at{" "}
                {r.value}
                {r.unit ? ` ${r.unit}` : ""}.
              </li>
            ))}
          </ul>
          <p className="font-body text-xs text-muted">
            General information, not a diagnosis — worth discussing with a
            qualified professional.
          </p>
        </Card>
      )}

      {readingGroups.map((group) => (
        <Card key={group.category} className="flex flex-col divide-y divide-border">
          <div className="px-5 pt-4 pb-2">
            <Eyebrow>{categoryLabel(group.category)}</Eyebrow>
          </div>
          {group.readings.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 px-5 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-body text-sm text-foreground">
                  {r.marker_name}
                </span>
                <span className="font-body text-xs text-muted">
                  {rangeText(r.reference_range_low, r.reference_range_high, r.unit)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-body text-sm font-medium text-foreground">
                  {r.value}
                  {r.unit ? (
                    <span className="ml-1 text-xs font-normal text-muted">
                      {r.unit}
                    </span>
                  ) : null}
                </span>
                <FlagPill flag={r.flag} />
              </div>
            </div>
          ))}
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
