"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { POINTS } from "@/lib/points";
import { Card, Eyebrow, PageHeader, primaryButtonClass } from "./ui";

/**
 * Future You — the six-month directional outlook. Panels land once or twice a
 * year, so the screen leads with what the user controls daily (habit momentum)
 * and frames the next panel as the scoreboard that verifies it. Motivational,
 * not diagnostic: no invented numbers on a single panel, no dosing language.
 */

interface HabitSignals {
  checkinRate: number;
  avgSleep: number | null;
  trainingDaysPerWeek: number;
  energyDelta: number | null;
}

interface Momentum {
  score: number;
  level: "strong" | "building" | "early";
  signals: HabitSignals;
}

interface MarkerOutlook {
  marker_key: string;
  marker_name: string | null;
  current_value: number | null;
  flag: string;
  outlook: "improving" | "holding" | "needs_inputs";
  projected_value: number | null;
  projection_date: string | null;
  model: "habit_v1" | "linear_v1";
}

interface Retest {
  lastPanelDate: string;
  dueDate: string;
  daysUntilDue: number;
}

interface InterventionRow {
  id: string;
  type: string;
  label: string;
  started_at: string;
}

interface FutureData {
  momentum: Momentum;
  markers: MarkerOutlook[];
  inRangeCount: number;
  retest: Retest | null;
  panelCount: number;
  interventions: InterventionRow[];
}

const DISCLAIMER = "Educational, not a diagnosis — please consult a doctor.";

const OUTLOOK_META: Record<
  MarkerOutlook["outlook"],
  { label: string; cls: string }
> = {
  improving: { label: "Set up to improve", cls: "bg-accent/10 text-accent" },
  holding: { label: "Holding — keep going", cls: "bg-clay/10 text-clay" },
  needs_inputs: { label: "Needs your daily inputs", cls: "bg-surface-2 text-muted" },
};

const MOMENTUM_COPY: Record<Momentum["level"], string> = {
  strong:
    "Your daily inputs are strongly on your side. Six months of this is exactly what moves the markers below.",
  building:
    "You're building a base. More consistent check-ins, sleep and training tilt the next panel your way.",
  early:
    "Your next panel will reflect what you do daily. Start with the check-in — it takes 30 seconds.",
};

export function FutureView({
  getToken,
  onCheckIn,
  onUploadPanel,
}: {
  getToken: () => Promise<string | null>;
  onCheckIn?: () => void;
  onUploadPanel?: () => void;
}) {
  const [data, setData] = useState<FutureData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return setStatus("error");
      const res = await fetch("/api/future", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return setStatus("error");
      setData((await res.json()) as FutureData);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load Future You:", err);
      setStatus("error");
    }
  }, [getToken]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  if (status === "loading") {
    return <p className="font-body text-sm text-muted">Looking ahead…</p>;
  }
  if (status === "error" || !data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-body text-sm text-muted">
          Couldn&rsquo;t load your outlook.
        </p>
        <button
          onClick={() => {
            setStatus("loading");
            void load();
          }}
          className={primaryButtonClass}
        >
          Try again
        </button>
      </div>
    );
  }

  // No panel yet — the outlook needs a baseline.
  if (data.panelCount === 0) {
    return (
      <div className="flex w-full max-w-xl flex-col gap-6">
        <PageHeader
          eyebrow="Future You"
          title="Six months out"
          subtitle="Your outlook starts from a baseline. Upload your lab report and we'll project from there."
        />
        {onUploadPanel && (
          <button onClick={onUploadPanel} className={`${primaryButtonClass} self-start`}>
            Upload your report
          </button>
        )}
        <p className="font-body text-xs text-muted">{DISCLAIMER}</p>
      </div>
    );
  }

  const m = data.momentum;
  const s = m.signals;

  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <PageHeader
        eyebrow="Future You"
        title="Six months out"
        subtitle="Lab tests come once or twice a year — what you do daily in between is what they'll show. This is the direction you're pointed in."
      />

      {/* The engine: habit momentum */}
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-baseline justify-between gap-4">
          <Eyebrow>Habit momentum</Eyebrow>
          <span className="font-display text-2xl font-medium text-foreground">
            {m.score}
            <span className="ml-1 font-body text-xs text-muted">/ 100</span>
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${m.score}%` }}
          />
        </div>
        <p className="font-body text-sm text-foreground/80">{MOMENTUM_COPY[m.level]}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Signal label="Check-ins" value={`${Math.round(s.checkinRate * 100)}%`} sub="last 30 days" />
          <Signal
            label="Sleep"
            value={s.avgSleep != null ? `${s.avgSleep}h` : "—"}
            sub="nightly avg"
          />
          <Signal label="Training" value={`${s.trainingDaysPerWeek}×`} sub="per week" />
          <Signal
            label="Energy"
            value={
              s.energyDelta == null
                ? "—"
                : s.energyDelta > 0
                  ? "rising"
                  : s.energyDelta < 0
                    ? "dipping"
                    : "steady"
            }
            sub="vs last month"
          />
        </div>
        {m.level !== "strong" && onCheckIn && (
          <button onClick={onCheckIn} className={`${primaryButtonClass} self-start`}>
            Do today&rsquo;s check-in
          </button>
        )}
      </Card>

      {/* The outcome layer: where flagged markers are headed */}
      {data.markers.length > 0 ? (
        <Card className="flex flex-col gap-1 p-6">
          <Eyebrow>Where your markers are pointed</Eyebrow>
          <p className="pb-2 font-body text-xs text-muted">
            Directional, based on{" "}
            {data.panelCount >= 2 ? "your panel history and " : ""}your daily
            inputs — your next panel is what confirms it.
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {data.markers.map((mk) => {
              const meta = OUTLOOK_META[mk.outlook];
              return (
                <li key={mk.marker_key} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-body text-sm text-foreground">
                      {mk.marker_name ?? mk.marker_key}
                    </span>
                    <span className="font-body text-xs text-muted">
                      now {mk.current_value ?? "—"}
                      {mk.model === "linear_v1" && mk.projected_value != null
                        ? ` → ~${mk.projected_value} by ${mk.projection_date}`
                        : ""}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 font-body text-xs font-medium ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                </li>
              );
            })}
          </ul>
          {data.inRangeCount > 0 && (
            <p className="pt-2 font-body text-xs text-muted">
              The other {data.inRangeCount} markers are in range — momentum keeps
              them there.
            </p>
          )}
        </Card>
      ) : (
        <Card className="flex flex-col gap-1 p-6">
          <Eyebrow>Where your markers are pointed</Eyebrow>
          <p className="font-body text-sm text-foreground/80">
            Everything on your last panel was in range. The goal for the next six
            months: keep it that way — momentum is how.
          </p>
        </Card>
      )}

      {/* The running experiment */}
      {data.interventions.length > 0 && (
        <Card className="flex flex-col gap-2 p-6">
          <Eyebrow>Your running experiment</Eyebrow>
          <ul className="flex flex-col gap-1.5">
            {data.interventions.map((iv) => (
              <li key={iv.id} className="font-body text-sm text-foreground/80">
                <span className="font-medium text-foreground">{iv.label}</span>
                <span className="text-muted"> — day {dayOf(iv.started_at)}. </span>
                Your next panel is the readout.
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* The scoreboard */}
      {data.retest && (
        <Card className="flex flex-col gap-2 border-accent/20 bg-accent/5 p-6">
          <Eyebrow>The scoreboard</Eyebrow>
          <p className="font-display text-xl font-medium text-foreground">
            {data.retest.daysUntilDue > 0
              ? `Next panel in ~${data.retest.daysUntilDue} days`
              : "Your re-test window is open"}
          </p>
          <p className="font-body text-sm text-foreground/80">
            {data.retest.daysUntilDue > 0
              ? `Around ${data.retest.dueDate}, a re-test shows what these months actually did — and earns +${POINTS.reTestUpload} iki points.`
              : `It's been six months since your ${data.retest.lastPanelDate} panel. A re-test now shows what your habits did — and earns +${POINTS.reTestUpload} iki points.`}
          </p>
        </Card>
      )}

      <p className="font-body text-xs text-muted">
        Directional and motivational, not a prediction of your actual results.{" "}
        {DISCLAIMER}
      </p>
    </div>
  );
}

function Signal({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-card bg-surface-2/60 px-3 py-2.5">
      <span className="font-body text-[10px] uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="font-body text-sm font-medium text-foreground">{value}</span>
      <span className="font-body text-[10px] text-muted">{sub}</span>
    </div>
  );
}

function dayOf(startedAt: string): number {
  const days = Math.floor((Date.now() - Date.parse(startedAt)) / 86_400_000) + 1;
  return Math.max(1, days);
}
