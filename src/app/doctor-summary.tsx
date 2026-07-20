"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Card,
  Eyebrow,
  PageHeader,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

interface FlaggedMarker {
  name: string;
  value: number | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: string;
}
interface Delta {
  marker_key: string;
  marker_name: string | null;
  baseline_value: number | null;
  latest_value: number | null;
  delta: number | null;
  improved: boolean;
}
interface Intervention {
  type: string;
  label: string;
  dose_note: string | null;
  started_at: string;
}
interface SummaryData {
  generatedAt: string;
  profile: { name: string; dob: string | null; sex: string | null };
  latestPanel: {
    date: string;
    lab: string | null;
    totalCount: number;
    flagged: FlaggedMarker[];
  } | null;
  sinceBaseline: {
    baselineDate: string;
    latestDate: string;
    deltas: Delta[];
  } | null;
  lifestyle: {
    avgEnergy: number | null;
    avgSleep: number | null;
    checkinCount: number;
    streak: number;
    interventions: Intervention[];
  };
}

const DISCLAIMER = "Educational, not a diagnosis — please consult a doctor.";

function rangeText(low: number | null, high: number | null, unit: string | null): string {
  const u = unit ? ` ${unit}` : "";
  if (low != null && high != null) return `${low}–${high}${u}`;
  if (low != null) return `≥ ${low}${u}`;
  if (high != null) return `≤ ${high}${u}`;
  return "—";
}

export function DoctorSummary({
  getToken,
  onBack,
}: {
  getToken: () => Promise<string | null>;
  onBack: () => void;
}) {
  const [data, setData] = useState<SummaryData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      if (!token) return setStatus("error");
      const res = await fetch("/api/summary", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return setStatus("error");
      setData((await res.json()) as SummaryData);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load summary:", err);
      setStatus("error");
    }
  }, [getToken]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  async function makePdf(): Promise<Blob> {
    const { jsPDF } = await import("jspdf");
    return buildSummaryPdf(new jsPDF({ unit: "mm", format: "a4" }), data!);
  }

  async function handleShare() {
    if (!data) return;
    setBusy(true);
    setNote(null);
    try {
      const blob = await makePdf();
      const file = new File([blob], "ikigaro-health-summary.pdf", { type: "application/pdf" });
      const nav = navigator as Navigator & {
        canShare?: (d: { files: File[] }) => boolean;
        share?: (d: unknown) => Promise<void>;
      };
      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        try {
          await nav.share({
            files: [file],
            title: "Ikigaro health summary",
            text: "My Ikigaro health summary",
          });
          return;
        } catch (err) {
          if ((err as Error).name === "AbortError") return; // user cancelled
          // otherwise fall through to download
        }
      }
      downloadBlob(blob, file.name);
      setNote("Sharing isn't available on this device — the PDF was downloaded instead.");
    } catch (err) {
      console.error("Share failed:", err);
      setNote("Couldn't create the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    if (!data) return;
    setBusy(true);
    setNote(null);
    try {
      downloadBlob(await makePdf(), "ikigaro-health-summary.pdf");
    } catch (err) {
      console.error("Download failed:", err);
      setNote("Couldn't create the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return <p className="font-body text-sm text-muted">Preparing your summary…</p>;
  }
  if (status === "error" || !data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-body text-sm text-muted">Couldn&rsquo;t load your summary.</p>
        <div className="flex gap-3">
          <button onClick={() => void load()} className={primaryButtonClass}>Try again</button>
          <button onClick={onBack} className={secondaryButtonClass}>Back</button>
        </div>
      </div>
    );
  }

  const { profile, latestPanel, sinceBaseline, lifestyle } = data;

  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          eyebrow="For your doctor"
          title="Health summary"
          subtitle="A one-page summary you can share with a clinician."
        />
        <button onClick={onBack} className={`${secondaryButtonClass} shrink-0`}>Back</button>
      </div>

      {/* On-screen preview — mirrors the PDF */}
      <Card className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-lg font-medium text-foreground">{profile.name}</span>
          <span className="font-body text-xs text-muted">
            {[profile.sex, profile.dob ? `DOB ${profile.dob}` : null].filter(Boolean).join(" · ") || "—"}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <Eyebrow>Latest lab panel</Eyebrow>
          {latestPanel ? (
            <>
              <p className="font-body text-xs text-muted">
                {latestPanel.date}
                {latestPanel.lab ? ` · ${latestPanel.lab}` : ""}
              </p>
              {latestPanel.flagged.length === 0 ? (
                <p className="font-body text-sm text-foreground/80">
                  All {latestPanel.totalCount} measured markers within range.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {latestPanel.flagged.map((m) => (
                    <li key={m.name} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate font-body text-sm text-foreground">{m.name}</span>
                      <span className="shrink-0 font-body text-sm">
                        <span className="font-medium text-foreground">
                          {m.value}{m.unit ? ` ${m.unit}` : ""}
                        </span>
                        <span className="ml-2 text-muted">({rangeText(m.refLow, m.refHigh, m.unit)})</span>
                        <span className="ml-2 uppercase text-accent">{m.flag}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="font-body text-sm text-muted">No lab panel on file yet.</p>
          )}
        </div>

        {sinceBaseline && sinceBaseline.deltas.length > 0 && (
          <div className="flex flex-col gap-2">
            <Eyebrow>Since baseline</Eyebrow>
            <p className="font-body text-xs text-muted">
              {sinceBaseline.baselineDate} → {sinceBaseline.latestDate}
            </p>
            <ul className="flex flex-col divide-y divide-border">
              {sinceBaseline.deltas.map((d) => (
                <li key={d.marker_key} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate font-body text-sm text-foreground">
                    {d.marker_name ?? d.marker_key}
                    {d.improved && <span className="ml-2 text-xs text-clay">improved</span>}
                  </span>
                  <span className="shrink-0 font-body text-sm text-muted">
                    {d.baseline_value} → {d.latest_value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Eyebrow>Lifestyle context</Eyebrow>
          <p className="font-body text-sm text-foreground/80">
            Avg energy {lifestyle.avgEnergy ?? "—"}/5 · Avg sleep{" "}
            {lifestyle.avgSleep != null ? `${lifestyle.avgSleep}h` : "—"} · {lifestyle.streak}-day streak ·{" "}
            {lifestyle.checkinCount} check-ins
          </p>
          {lifestyle.interventions.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="font-body text-xs text-muted">Current interventions</span>
              <ul className="flex flex-col gap-0.5">
                {lifestyle.interventions.map((it, i) => (
                  <li key={i} className="font-body text-sm text-foreground/80">
                    {it.label}
                    {it.dose_note ? ` — ${it.dose_note}` : ""}
                    <span className="text-muted"> (since {it.started_at})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <p className="font-body text-xs text-muted">{DISCLAIMER}</p>
      </Card>

      {note && <p className="font-body text-sm text-muted">{note}</p>}

      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <button onClick={() => void handleShare()} disabled={busy} className={`${primaryButtonClass} w-full sm:flex-1`}>
          {busy ? "Preparing…" : "Share PDF"}
        </button>
        <button onClick={() => void handleDownload()} disabled={busy} className={`${secondaryButtonClass} w-full sm:flex-1`}>
          Download PDF
        </button>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lay out the one-page summary. jsPDF is imported lazily by the caller. */
function buildSummaryPdf(
  doc: import("jspdf").jsPDF,
  data: SummaryData,
): Blob {
  const M = 16; // margin mm
  const W = doc.internal.pageSize.getWidth();
  const right = W - M;
  let y = M;

  const line = (txt: string, size = 10, style: "normal" | "bold" = "normal", color = 30) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color);
    doc.text(txt, M, y);
    y += size * 0.5;
  };
  const rule = () => {
    doc.setDrawColor(210);
    doc.line(M, y, right, y);
    y += 4;
  };
  const gap = (mm = 3) => (y += mm);

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text("Ikigaro — Health Summary", M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Generated ${data.generatedAt.slice(0, 10)}`, right, y, { align: "right" });
  y += 7;
  rule();

  // Patient
  line(data.profile.name, 12, "bold", 20);
  line(
    [data.profile.sex, data.profile.dob ? `DOB ${data.profile.dob}` : null].filter(Boolean).join("  ·  ") || "—",
    9,
    "normal",
    110,
  );
  gap();

  // Latest panel
  if (data.latestPanel) {
    line("LATEST LAB PANEL", 9, "bold", 150);
    line(
      `${data.latestPanel.date}${data.latestPanel.lab ? `  ·  ${data.latestPanel.lab}` : ""}`,
      9,
      "normal",
      110,
    );
    gap(1);
    if (data.latestPanel.flagged.length === 0) {
      line(`All ${data.latestPanel.totalCount} measured markers within range.`, 10);
    } else {
      for (const m of data.latestPanel.flagged) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(30);
        doc.text(m.name, M, y);
        const rhs = `${m.value ?? "—"}${m.unit ? ` ${m.unit}` : ""}   (${rangeText(m.refLow, m.refHigh, m.unit)})   ${m.flag.toUpperCase()}`;
        doc.text(rhs, right, y, { align: "right" });
        y += 5;
      }
    }
    gap();
  }

  // Since baseline
  if (data.sinceBaseline && data.sinceBaseline.deltas.length > 0) {
    line("SINCE BASELINE", 9, "bold", 150);
    line(`${data.sinceBaseline.baselineDate}  →  ${data.sinceBaseline.latestDate}`, 9, "normal", 110);
    gap(1);
    for (const d of data.sinceBaseline.deltas) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(30);
      doc.text(`${d.marker_name ?? d.marker_key}${d.improved ? "  (improved)" : ""}`, M, y);
      doc.text(`${d.baseline_value} → ${d.latest_value}`, right, y, { align: "right" });
      y += 5;
    }
    gap();
  }

  // Lifestyle
  line("LIFESTYLE CONTEXT", 9, "bold", 150);
  line(
    `Avg energy ${data.lifestyle.avgEnergy ?? "—"}/5   ·   Avg sleep ${data.lifestyle.avgSleep != null ? `${data.lifestyle.avgSleep}h` : "—"}   ·   ${data.lifestyle.streak}-day streak   ·   ${data.lifestyle.checkinCount} check-ins`,
    10,
  );
  if (data.lifestyle.interventions.length > 0) {
    gap(1);
    line("Current interventions:", 9, "bold", 110);
    for (const it of data.lifestyle.interventions) {
      line(`• ${it.label}${it.dose_note ? ` — ${it.dose_note}` : ""}  (since ${it.started_at})`, 9, "normal", 60);
    }
  }
  gap(4);
  rule();

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(130);
  doc.text(DISCLAIMER, M, y);

  return doc.output("blob");
}
