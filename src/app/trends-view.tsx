"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { POINTS, REFERRAL_MAX_TOTAL } from "@/lib/points";
import type { CheckinTrend, MarkerDelta } from "@/lib/trends";
import { DeviceDetail } from "./device-detail";
import { TrainingCard } from "./training-card";
import { WearableTrends } from "./wearable-trends";

interface CheckinSeriesPoint {
  checkin_date: string;
  energy_score: number | null;
  sleep_hours: number | null;
}
interface OutcomeBonus {
  marker_key: string;
  /** Resolved from the catalog by /api/trends. Null when it has no row. */
  marker_name: string | null;
  delta_value: number | null;
  amount: number;
  verified_at: string | null;
}

/**
 * What to call a marker in the reward line.
 *
 * The catalog name when there is one. Otherwise the key made readable rather
 * than shouted: this line used to print VISCERAL_FAT, which is a column name
 * wearing a hat, and it appeared at the exact moment the app is supposed to be
 * congratulating somebody. The fallback keeps a marker that has fallen out of
 * the catalog legible instead of hiding the reward entirely.
 */
export function markerLabel(bonus: Pick<OutcomeBonus, "marker_key" | "marker_name">): string {
  if (bonus.marker_name) return bonus.marker_name;
  const words = bonus.marker_key.replace(/_/g, " ").trim();
  if (!words) return "A marker";
  return words.charAt(0).toUpperCase() + words.slice(1);
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

const DISCLAIMER = "Educational, not a diagnosis. Please consult a doctor.";

/** Kept in sync with docs/FAQ.md; values come from the POINTS table so this
 * copy can never drift from the live economy. */
const FAQ: { q: string; a: string }[] = [
  {
    q: "How do I earn iki points?",
    a: `${POINTS.checkin} points for your first daily check-in, streak bonuses (${POINTS.streak7Bonus} at 7 days, ${POINTS.streak30Bonus} at 30), ${POINTS.firstPanelUpload} for your first lab panel and ${POINTS.reTestUpload} per genuine re-test, points when a marker genuinely improves between panels, and up to ${REFERRAL_MAX_TOTAL} per friend you refer (see Rewards → Invite friends).`,
  },
  {
    q: "What is an outcome-verified reward?",
    a: "Points for a marker moving in its healthy direction between panels, and we keep rewarding continued improvement, not just the first time it reaches the normal range (e.g. visceral fat 9 → 8 → 6.5 earns at each step).",
  },
  {
    q: "How often can a lab panel earn improvement rewards?",
    a: "At most once every 14 days. Panels uploaded closer together are still saved and shown in your trends, they're important health data, but don't earn improvement points.",
  },
  {
    q: "Why the 14-day rule?",
    a: "During illness or recovery your markers (white/red blood cells especially) swing a lot as your body fights infection. The bi-weekly floor keeps rewards tied to genuine change, while still recording every result.",
  },
  {
    q: "Are results that don't earn points still saved?",
    a: "Yes. Every panel is stored and part of your trends and doctor-ready history. Rewards are a bonus for genuine progress, never a gate on your data.",
  },
];

function RewardsFaq() {
  return (
    <section className="iki-card flex flex-col gap-2">
      <p className="iki-eyebrow">Rewards &amp; trends. FAQ</p>
      <div className="flex flex-col">
        {FAQ.map((item) => (
          <details key={item.q} className="group border-b border-line py-2 last:border-b-0">
            {/* The summary carries the 44px hit area rather than a min-height,
                so an answered question does not leave a band of dead space
                above its answer. */}
            <summary className="iki-tap iki-press list-none text-body-sm font-semibold text-ink marker:hidden">
              <span className="text-primary group-open:hidden">＋ </span>
              <span className="hidden text-primary group-open:inline">− </span>
              {item.q}
            </summary>
            <p className="pt-2 text-body-sm text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** A tiny inline sparkline, no chart library, keeps the Worker bundle lean. */
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
  return tone === "up" ? "text-clay" : tone === "down" ? "text-primary" : "text-muted";
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
    return <p className="text-body-sm text-muted">Loading your trends…</p>;
  }
  if (status === "error" || !data) {
    return (
      <div className="flex w-full max-w-xl flex-col gap-4">
        <p className="text-body-sm text-muted">Couldn&rsquo;t load your trends.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="iki-btn iki-btn-primary w-full"
        >
          Try again
        </button>
      </div>
    );
  }

  const { checkin, biomarker, bonuses } = data;
  const energyDelta = deltaLabel(checkin.trend.energyDelta, "");
  const sleepDelta = deltaLabel(checkin.trend.sleepDelta, "h");

  return (
    <div className="flex w-full max-w-xl flex-col gap-stack">
      {/* Written out rather than using PageHeader, whose tracking and title
          size predate the token scale. That component still serves the screens
          this restyle has not reached. */}
      <header className="flex flex-col gap-1.5">
        <p className="iki-eyebrow">Trends</p>
        <h1 className="iki-title">Your movement</h1>
        <p className="iki-lede">
          Day-to-day from your check-ins, and the bigger picture from your lab panels.
        </p>
      </header>

      {/*
        CHECK-IN TREND LEADS. Everybody has check-ins; the device cards below
        render for the few people with a ring, and leading with a section that
        is empty for most members put the page's first screenful in the hands
        of the smallest group on it.
      */}
      <section className="iki-card flex flex-col gap-3.5">
        <p className="iki-eyebrow">Check-in trend</p>
        {checkin.trend.count === 0 ? (
          <p className="text-body-sm text-muted">
            Check in daily and your energy &amp; sleep trend will build here.
          </p>
        ) : (
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3.5">
              <div className="flex flex-col gap-1">
                <span className="text-micro text-muted">Avg energy (7d)</span>
                <span className="font-display text-display-md font-medium leading-none text-ink">
                  {checkin.trend.avgEnergy ?? "-"}
                  {/* The delta drops into the sans face beside the numeral,
                      the same treatment a unit gets: a serif arrow reads as an
                      ornament rather than as a value. `text-micro` and not
                      `text-eyebrow`, which carries 0.2em of tracking that
                      would push the arrow away from its own number. */}
                  <span className={`ml-2 font-sans text-micro ${toneClass(energyDelta.tone)}`}>
                    {checkin.trend.energyDelta != null ? energyDelta.text : ""}
                  </span>
                </span>
                <span className="text-clay">
                  <Sparkline values={checkin.series.map((p) => p.energy_score ?? NaN)} />
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-micro text-muted">Avg sleep (7d)</span>
                <span className="font-display text-display-md font-medium leading-none text-ink">
                  {checkin.trend.avgSleep != null ? `${checkin.trend.avgSleep}h` : "-"}
                  <span className={`ml-2 font-sans text-micro ${toneClass(sleepDelta.tone)}`}>
                    {checkin.trend.sleepDelta != null ? sleepDelta.text : ""}
                  </span>
                </span>
                <span className="text-clay">
                  <Sparkline values={checkin.series.map((p) => p.sleep_hours ?? NaN)} />
                </span>
              </div>
            </div>
            {/* Training days used to be counted here too. It now lives in the
                Training card, which reconciles the check-in against any
                connected device; two counts of the same week on one page
                differ the moment a ring is connected, and the user has no way
                to tell which one to believe. */}
            <p className="text-micro text-muted">
              {checkin.trend.count} check-in{checkin.trend.count === 1 ? "" : "s"} logged
            </p>
          </div>
        )}
      </section>

      {/* Outcome-verified rewards, the payoff moment. */}
      {bonuses.length > 0 && (
        <section className="iki-card iki-card-tight flex flex-col gap-2">
          <p className="iki-eyebrow">You improved</p>
          <ul className="flex flex-col gap-1">
            {bonuses.map((b, i) => (
              <li key={i} className="text-body-sm leading-relaxed text-ink">
                <span className="font-semibold">{markerLabel(b)}</span>{" "}
                moved into range{b.delta_value != null ? ` (${b.delta_value})` : ""} -{" "}
                <span className="font-semibold text-clay">+{b.amount} iki points</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Biomarker since-baseline, the infrequent, high-value signal. */}
      <section className="iki-card flex flex-col gap-2.5">
        <p className="iki-eyebrow">Since your baseline</p>
        {biomarker.panelCount < 2 ? (
          <p className="text-body-sm text-muted">
            You have one lab panel so far. Lab work is usually months apart. When you
            upload your next panel you&rsquo;ll see exactly which markers moved, and earn
            iki points for any that improve into range.
          </p>
        ) : (
          <>
            <p className="text-micro text-muted">
              {biomarker.baselineDate} → {biomarker.latestDate}
            </p>
            <ul className="flex flex-col">
              {biomarker.deltas.slice(0, 12).map((d) => {
                const dl = deltaLabel(d.delta, "");
                return (
                  <li key={d.marker_key} className="iki-row">
                    <span className="min-w-0 text-body-sm text-ink">
                      {d.marker_name ?? d.marker_key}
                      {(d.moved_into_range || d.improved) && (
                        <span className="iki-badge iki-badge-good ml-2">
                          {d.moved_into_range ? "into range" : "improved"}
                        </span>
                      )}
                    </span>
                    {/* Never wrapped: "24 → 31" split over two lines reads as
                        two unrelated numbers rather than one movement. */}
                    <span className="shrink-0 whitespace-nowrap text-caption text-muted">
                      {d.baseline_value} → {d.latest_value}
                      {/* Direction of "good" varies per marker, so keep the delta neutral;
                          the into-range badge is the health signal. */}
                      <span className="ml-2">{d.delta != null ? dl.text : ""}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/*
        NOT IN THE MOCKUP, KEPT ANYWAY, and placed after its three cards.
        Each renders itself away when there is nothing to show, which is why
        they can sit here without leaving holes in the page for most members.
      */}

      {/* Device data, merged across everything connected. */}
      <WearableTrends getToken={getToken} />

      {/* What you did this week, and whether the body is absorbing it. Reads
          the check-in first and a device second, so it works before anyone
          owns a ring. */}
      <TrainingCard getToken={getToken} />

      {/* The unmerged view, one collapsed panel per connected device. Answers
          "what is this thing actually sending you", which the merged card
          above deliberately cannot: it resolves several devices into one
          number and hides which device won. */}
      <DeviceDetail getToken={getToken} />

      <RewardsFaq />

      <p className="text-micro text-muted">{DISCLAIMER}</p>
    </div>
  );
}
