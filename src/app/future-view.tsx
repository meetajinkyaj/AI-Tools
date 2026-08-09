"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { POINTS } from "@/lib/points";


/**
 * Future You, the six-month directional outlook. Panels land once or twice a
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

const DISCLAIMER = "Educational, not a diagnosis. Please consult a doctor.";

/*
 * Three outlooks, three badge variants from the token layer.
 *
 * `improving` is terracotta because it is the one the member is doing
 * something about; `holding` is clay, this system's colour for a thing that is
 * already true; `needs_inputs` is neutral, because it is an absence of data
 * rather than a verdict about the body. None of them is red.
 */
const OUTLOOK_META: Record<
  MarkerOutlook["outlook"],
  { label: string; cls: string }
> = {
  improving: { label: "Set up to improve", cls: "iki-badge-primary" },
  holding: { label: "Holding, keep going", cls: "iki-badge-good" },
  needs_inputs: { label: "Needs your daily inputs", cls: "iki-badge-neutral" },
};

const MOMENTUM_COPY: Record<Momentum["level"], string> = {
  strong:
    "Your daily inputs are strongly on your side. Six months of this is exactly what moves the markers below.",
  building:
    "You're building a base. More consistent check-ins, sleep and training tilt the next panel your way.",
  early:
    "Your next panel will reflect what you do daily. Start with the check-in. It takes 30 seconds.",
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
    return <p className="text-body-sm text-muted">Looking ahead…</p>;
  }
  if (status === "error" || !data) {
    return (
      <div className="flex w-full max-w-xl flex-col gap-4">
        <p className="text-body-sm text-muted">Couldn&rsquo;t load your outlook.</p>
        <button
          type="button"
          onClick={() => {
            setStatus("loading");
            void load();
          }}
          className="iki-btn iki-btn-primary w-full"
        >
          Try again
        </button>
      </div>
    );
  }

  // No panel yet, the outlook needs a baseline.
  if (data.panelCount === 0) {
    return (
      <div className="flex w-full max-w-xl flex-col gap-stack">
        <header className="flex flex-col gap-1.5">
          <p className="iki-eyebrow">Future You</p>
          <h1 className="iki-title">Six months out</h1>
          <p className="iki-lede">
            Your outlook starts from a baseline. Upload your lab report and we&rsquo;ll
            project from there.
          </p>
        </header>
        {onUploadPanel && (
          <button
            type="button"
            onClick={onUploadPanel}
            className="iki-btn iki-btn-primary w-full"
          >
            Upload your report
          </button>
        )}
        <p className="text-micro text-muted">{DISCLAIMER}</p>
      </div>
    );
  }

  const m = data.momentum;
  const s = m.signals;

  return (
    <div className="flex w-full max-w-xl flex-col gap-stack">
      <header className="flex flex-col gap-1.5">
        <p className="iki-eyebrow">Future You</p>
        <h1 className="iki-title">Six months out</h1>
        <p className="iki-lede">
          Lab tests come once or twice a year, what you do daily in between is what
          they&rsquo;ll show. This is the direction you&rsquo;re pointed in.
        </p>
      </header>

      {/* The engine: habit momentum */}
      <section className="iki-card flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <p className="iki-eyebrow">Habit momentum</p>
          <span className="font-display text-display-md font-medium text-ink">
            {m.score}
            <span className="ml-1 font-sans text-eyebrow text-muted">/ 100</span>
          </span>
        </div>
        {/* Terracotta rather than clay: this bar sits directly above a button
            asking for today's check-in, so it is about an action rather than
            about something that has already happened. */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={m.score}
          aria-label="Habit momentum"
          className="iki-bar"
        >
          <div
            className="iki-bar-fill iki-bar-fill-primary"
            style={{ width: `${m.score}%` }}
          />
        </div>
        <p className="text-caption leading-relaxed text-ink">{MOMENTUM_COPY[m.level]}</p>
        {/* Two by two at every width. Four across on a wide screen turns a
            summary into a dashboard strip, and this card is read on a phone. */}
        <div className="grid grid-cols-2 gap-2">
          <Signal label="Check-ins" value={`${Math.round(s.checkinRate * 100)}%`} sub="last 30 days" />
          <Signal
            label="Sleep"
            value={s.avgSleep != null ? `${s.avgSleep}h` : "-"}
            sub="nightly avg"
          />
          <Signal label="Training" value={`${s.trainingDaysPerWeek}×`} sub="per week" />
          <Signal
            label="Energy"
            value={
              s.energyDelta == null
                ? "-"
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
          <button
            type="button"
            onClick={onCheckIn}
            className="iki-btn iki-btn-primary self-start"
          >
            Do today&rsquo;s check-in
          </button>
        )}
      </section>

      {/* The outcome layer: where flagged markers are headed */}
      {data.markers.length > 0 ? (
        <section className="iki-card flex flex-col gap-1.5">
          <p className="iki-eyebrow">Where your markers are pointed</p>
          <p className="mb-1 text-micro text-muted">
            Directional, based on{" "}
            {data.panelCount >= 2 ? "your panel history and " : ""}your daily
            inputs, your next panel is what confirms it.
          </p>
          <ul className="flex flex-col">
            {data.markers.map((mk) => {
              const meta = OUTLOOK_META[mk.outlook];
              return (
                <li key={mk.marker_key} className="iki-row">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-body-sm text-ink">
                      {mk.marker_name ?? mk.marker_key}
                    </span>
                    <span className="text-micro text-muted">
                      now {mk.current_value ?? "-"}
                      {mk.model === "linear_v1" && mk.projected_value != null
                        ? ` → ~${mk.projected_value} by ${mk.projection_date}`
                        : ""}
                    </span>
                  </div>
                  <span className={`iki-badge ${meta.cls} shrink-0`}>{meta.label}</span>
                </li>
              );
            })}
          </ul>
          {data.inRangeCount > 0 && (
            <p className="mt-1 text-micro text-muted">
              The other {data.inRangeCount} markers are in range, momentum keeps
              them there.
            </p>
          )}
        </section>
      ) : (
        <section className="iki-card flex flex-col gap-1.5">
          <p className="iki-eyebrow">Where your markers are pointed</p>
          <p className="text-body-sm text-ink">
            Everything on your last panel was in range. The goal for the next six
            months: keep it that way, momentum is how.
          </p>
        </section>
      )}

      {/* The running experiment */}
      {data.interventions.length > 0 && (
        <section className="iki-card flex flex-col gap-2">
          <p className="iki-eyebrow">Your running experiment</p>
          <ul className="flex flex-col gap-1.5">
            {data.interventions.map((iv) => (
              <li key={iv.id} className="text-body-sm text-ink">
                <span className="font-semibold">{iv.label}</span>
                <span className="text-muted">, day {dayOf(iv.started_at)}. </span>
                Your next panel is the readout.
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* THE SCOREBOARD, and the only tinted card in the app. It is the one
          moment the screen points at something outside itself, so it gets the
          one exception to the border-defined card. */}
      {data.retest && (
        <section className="iki-card iki-card-accent iki-card-tight flex flex-col gap-1.5">
          <p className="iki-eyebrow">The scoreboard</p>
          <p className="font-display text-display-sm font-medium text-ink">
            {data.retest.daysUntilDue > 0
              ? `Next panel in ~${data.retest.daysUntilDue} days`
              : "Your re-test window is open"}
          </p>
          <p className="text-unit leading-relaxed text-muted">
            {data.retest.daysUntilDue > 0
              ? `Around ${data.retest.dueDate}, a re-test shows what these months actually did, and earns +${POINTS.reTestUpload} iki points.`
              : `It's been six months since your ${data.retest.lastPanelDate} panel. A re-test now shows what your habits did, and earns +${POINTS.reTestUpload} iki points.`}
          </p>
        </section>
      )}

      <p className="text-micro text-muted">
        Directional and motivational, not a prediction of your actual results.{" "}
        {DISCLAIMER}
      </p>
    </div>
  );
}

function Signal({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="iki-well">
      <span className="iki-well-label">{label}</span>
      <span className="iki-well-value">{value}</span>
      <span className="iki-well-meta">{sub}</span>
    </div>
  );
}

function dayOf(startedAt: string): number {
  const days = Math.floor((Date.now() - Date.parse(startedAt)) / 86_400_000) + 1;
  return Math.max(1, days);
}
