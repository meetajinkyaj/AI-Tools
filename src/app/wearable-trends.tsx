"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, Eyebrow } from "./ui";

/**
 * "From your devices" in Trends.
 *
 * Shows the MERGED series, one number per metric per day, resolved server-side
 * from every connected device. The client never sees the per-provider rows and
 * never applies the resolution rules itself: the same merge feeds Future You,
 * and two implementations is how the chart and the model start disagreeing
 * about what your sleep was.
 *
 * Each metric names where its numbers came from, and says so honestly when
 * that is more than one device, a user comparing this against Oura's own app
 * needs to know which nights came from the ring and which from the watch.
 */

interface Point {
  date: string;
  value: number;
  source: string;
}

interface Series {
  metric: string;
  label: string;
  unit: string;
  points: Point[];
  sources: string[];
}

/** Minutes read as hours; everything else is already in its own unit. */
function display(metric: string, value: number, unit: string): string {
  if (metric === "sleep_minutes") {
    const h = Math.floor(value / 60);
    const m = Math.round(value % 60);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
  const dp = unit === "%" || unit === "kg" || unit === "brpm" ? 1 : 0;
  // Grouped: a step count is the one number here that routinely runs to five
  // digits, and "12483" is harder to read at a glance than "12,483".
  const n = value.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  // "count" and "score" are descriptions of the number, not units you say out
  // loud, "9,000 count" and "55 score" both read as a bug.
  const bare = unit === "count" || unit === "score";
  return `${n}${bare ? "" : ` ${unit}`}`;
}

/**
 * Provider ids are lowercase because they travel in URLs and file paths. Nobody
 * writes their ring's name that way, so it gets capitalised on the way out.
 */
const BRAND: Record<string, string> = {
  oura: "Oura",
  fitbit: "Fitbit",
  whoop: "Whoop",
  withings: "Withings",
  garmin: "Garmin",
  ultrahuman: "Ultrahuman",
};

function brandName(id: string): string {
  return BRAND[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

function Sparkline({ points }: { points: Point[] }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 120;
  const h = 28;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.value - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function WearableTrends({ getToken }: { getToken: () => Promise<string | null> }) {
  const [series, setSeries] = useState<Series[] | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/wearables/metrics?days=30", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { series: Series[] };
      setSeries(body.series ?? []);
    } catch {
      /* Trends must render with or without devices */
    }
  }, [getToken]);

  useEffect(() => {
    // Wrapped rather than `void load()` so the lint rule can see that every
    // setState happens after an await, not synchronously inside the effect.
    void (async () => {
      await load();
    })();
  }, [load]);

  // Nothing connected, or nothing synced yet: show nothing at all rather than
  // an empty card. The pitch to connect lives on Home and in Settings; this
  // section only exists once there is something to look at.
  if (!series || series.length === 0) return null;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <Eyebrow>From your devices</Eyebrow>
        <p className="font-body text-xs text-muted">Last 30 days</p>
      </div>

      <ul className="flex flex-col gap-3">
        {series.map((s) => {
          const latest = s.points[s.points.length - 1];
          const mixed = s.sources.length > 1;
          return (
            <li
              key={s.metric}
              className="flex items-center justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-body text-sm text-foreground">{s.label}</span>
                <span className="font-body text-[0.7rem] text-muted">
                  {/* Naming the devices matters when there is more than one:
                      a user reconciling against a vendor's own app needs to
                      know which nights came from which device. */}
                  {mixed
                    ? `${s.sources.map(brandName).join(" + ")} · ${s.points.length} days`
                    : `${brandName(s.sources[0])} · ${s.points.length} days`}
                </span>
              </div>
              <div className="flex items-center gap-3 text-accent">
                <Sparkline points={s.points} />
                <span className="min-w-[4.5rem] text-right font-display text-lg font-medium text-foreground">
                  {display(s.metric, latest.value, s.unit)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
