"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CheckinTrend, MarkerDelta } from "@/lib/trends";
import { Card, Eyebrow, PageHeader, primaryButtonClass } from "./ui";

interface CheckinSeriesPoint {
  checkin_date: string;
  energy_score: number | null;
  sleep_hours: number | null;
}
interface OutcomeBonus {
  marker_key: string;
  delta_value: number | null;
  amount: number;
  verified_at: string | null;
}
interface TrendsData {
  checkin: { trend: CheckinTrend; series: CheckinSeriesPoint[] };
  biomarker: {
    panelCount: number;
    baselineDate: string | null;
    latestDate: string | null;
    deltas: MarkerDelta[];
  };
  bonuses: OutcomeBonus[];
}

const DISCLAIMER = "Educational, not a diagnosis — please consult a doctor.";

/** A tiny inline sparkline — no chart library, keeps the Worker bundle lean. */
function Sparkline({ values, className = "" }: { values: number[]; className?: string }) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const w = 120;
  const h = 28;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = w / (pts.length - 1);
  const d = pts
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function deltaLabel(delta: number | null, unit = "", betterWhenDown = false): {
  text: string;
  tone: "up" | "down" | "flat";
} {
  if (delta == null || delta === 0) return { text: "no change", tone: "flat" };
  const arrow = delta > 0 ? "▲" : "▼";
  const improved = betterWhenDown ? delta < 0 : delta > 0;
  return {
    text: `${arrow} ${Math.abs(delta)}${unit}`,
    tone: improved ? "up" : "down",
  };
}

function toneClass(tone: "up" | "down" | "flat"): string {
  return tone === "up" ? "text-clay" : tone === "down" ? "text-accent" : "text-muted";
}

export function TrendsView({ getToken }: { getToken: () => Promise<string | null> }) {
  const [data, setData] = useState<TrendsData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      if (!token) return setStatus("error");
      const res = await fetch("/api/trends", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return setStatus("error");
      setData((await res.json()) as TrendsData);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load trends:", err);
      setStatus("error");
    }
  }, [getToken]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  if (status === "loading") {
    return <p className="font-body text-sm text-muted">Loading your trends…</p>;
  }
  if (status === "error" || !data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-body text-sm text-muted">Couldn&rsquo;t load your trends.</p>
        <button onClick={() => void load()} className={primaryButtonClass}>
          Try again
        </button>
      </div>
    );
  }

  const { checkin, biomarker, bonuses } = data;
  const energyDelta = deltaLabel(checkin.trend.energyDelta, "");
  const sleepDelta = deltaLabel(checkin.trend.sleepDelta, "h");

  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <PageHeader
        eyebrow="Trends"
        title="Your movement"
        subtitle="Day-to-day from your check-ins, and the bigger picture from your lab panels."
      />

      {/* Outcome-verified rewards — the payoff moment */}
      {bonuses.length > 0 && (
        <Card className="flex flex-col gap-2 p-6">
          <Eyebrow>You improved</Eyebrow>
          <ul className="flex flex-col gap-1">
            {bonuses.map((b, i) => (
              <li key={i} className="font-body text-sm text-foreground/80">
                <span className="font-medium text-foreground">{b.marker_key.toUpperCase()}</span>{" "}
                moved into range{b.delta_value != null ? ` (${b.delta_value})` : ""} —{" "}
                <span className="font-medium text-clay">+{b.amount} iki points</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Check-in trend — the frequent signal */}
      <Card className="flex flex-col gap-4 p-6">
        <Eyebrow>Check-in trend</Eyebrow>
        {checkin.trend.count === 0 ? (
          <p className="font-body text-sm text-muted">
            Check in daily and your energy &amp; sleep trend will build here.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <span className="font-body text-xs text-muted">Avg energy (7d)</span>
                <span className="font-display text-2xl font-medium text-foreground">
                  {checkin.trend.avgEnergy ?? "—"}
                  <span className={`ml-2 font-body text-xs ${toneClass(energyDelta.tone)}`}>
                    {checkin.trend.energyDelta != null ? energyDelta.text : ""}
                  </span>
                </span>
                <span className="text-clay">
                  <Sparkline values={checkin.series.map((p) => p.energy_score ?? NaN)} />
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-body text-xs text-muted">Avg sleep (7d)</span>
                <span className="font-display text-2xl font-medium text-foreground">
                  {checkin.trend.avgSleep != null ? `${checkin.trend.avgSleep}h` : "—"}
                  <span className={`ml-2 font-body text-xs ${toneClass(sleepDelta.tone)}`}>
                    {checkin.trend.sleepDelta != null ? sleepDelta.text : ""}
                  </span>
                </span>
                <span className="text-clay">
                  <Sparkline values={checkin.series.map((p) => p.sleep_hours ?? NaN)} />
                </span>
              </div>
            </div>
            <p className="font-body text-xs text-muted">
              {checkin.trend.count} check-in{checkin.trend.count === 1 ? "" : "s"} logged ·{" "}
              {checkin.trend.trainingDays} training day{checkin.trend.trainingDays === 1 ? "" : "s"} this week
            </p>
          </div>
        )}
      </Card>

      {/* Biomarker since-baseline — the infrequent, high-value signal */}
      <Card className="flex flex-col gap-4 p-6">
        <Eyebrow>Since your baseline</Eyebrow>
        {biomarker.panelCount < 2 ? (
          <p className="font-body text-sm text-muted">
            You have one lab panel so far. Lab work is usually months apart — when you
            upload your next panel, you&rsquo;ll see exactly which markers moved, and earn
            iki points for any that improve into range.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="font-body text-xs text-muted">
              {biomarker.baselineDate} → {biomarker.latestDate}
            </p>
            <ul className="flex flex-col divide-y divide-border">
              {biomarker.deltas.slice(0, 12).map((d) => {
                const dl = deltaLabel(d.delta, "");
                return (
                  <li key={d.marker_key} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 font-body text-sm text-foreground">
                      {d.marker_name ?? d.marker_key}
                      {d.moved_into_range && (
                        <span className="ml-2 rounded-full bg-clay/10 px-2 py-0.5 font-body text-xs text-clay">
                          into range
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-body text-sm">
                      <span className="text-muted">{d.baseline_value} → {d.latest_value}</span>
                      {/* Direction of "good" varies per marker, so keep the delta neutral;
                          the into-range badge is the health signal. */}
                      <span className="ml-2 text-muted">{d.delta != null ? dl.text : ""}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <p className="font-body text-xs text-muted">{DISCLAIMER}</p>
    </div>
  );
}
