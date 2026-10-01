"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { todayUTC } from "@/lib/checkin";
import { POINTS, REFERRAL_MAX_TOTAL } from "@/lib/points";
import { barOpacity, signed, type WeekBar, weekBars } from "@/lib/week-bars";
import { formatPanelDate } from "./biomarker-report";
import { Icon, type IconName } from "./icons";
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

/** v2 copy (handoff section 4.4), the same line the Report now uses. */
const DISCLAIMER = "Information to explore, not a diagnosis. Worth a chat with your doctor.";

/**
 * The reward line, as one sentence in two tones (v2 section 4.4):
 * "Visceral fat moved into range. Down 1.5 since November, worth +120 iki."
 * Composed from the outcome bonus and the baseline date, never hand-written.
 */
export function insightParts(
  bonus: Pick<OutcomeBonus, "marker_key" | "marker_name" | "delta_value" | "amount">,
  baselineDate: string | null,
): { lead: string; middle: string; reward: string } {
  const month = baselineDate
    ? new Date(`${baselineDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
        month: "long",
        timeZone: "UTC",
      })
    : null;
  const moved =
    bonus.delta_value != null && bonus.delta_value !== 0
      ? `${bonus.delta_value < 0 ? "Down" : "Up"} ${Math.abs(bonus.delta_value)}${month ? ` since ${month}` : ""}, worth`
      : "Worth";
  return {
    lead: `${markerLabel(bonus)} moved into range.`,
    middle: moved,
    reward: `+${bonus.amount} iki.`,
  };
}

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

/**
 * One of the two week cards (energy, sleep): the average and its change on the
 * left, seven bars on the right. Bars use the data-only gradients.
 */
function WeekCard({
  icon,
  glyphClass,
  eyebrow,
  value,
  unit,
  delta,
  deltaClass,
  bars,
  max,
  kind,
  label,
}: {
  icon: IconName;
  glyphClass: string;
  eyebrow: string;
  value: number | null;
  unit?: string;
  delta: number | null;
  deltaClass: string;
  bars: WeekBar[];
  max: number;
  kind: "primary" | "recovery";
  label: string;
}) {
  return (
    <section className="iki-card flex items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <span className={`iki-glyph-well ${glyphClass}`} aria-hidden>
          <Icon name={icon} size={13} strokeWidth={2} />
        </span>
        <p className="iki-eyebrow">{eyebrow}</p>
        <p className="font-display text-display-hero text-ink">
          {value ?? "-"}
          {unit && value != null && <span className="font-sans text-unit text-muted">{unit}</span>}
        </p>
        {delta != null && delta !== 0 && (
          <span className="iki-delta self-start">
            <span className={deltaClass}>{signed(delta, unit ?? "")}</span>
            <span className="uppercase tracking-[0.1em] text-muted">vs last wk</span>
          </span>
        )}
      </div>
      <div className="iki-vbars" role="img" aria-label={label}>
        {bars.map((b, i) => (
          <div key={b.date} className="iki-vbar">
            <span className="iki-vbar-track">
              {b.value != null && (
                <span
                  className="iki-vbar-fill"
                  data-kind={kind}
                  style={{
                    height: `${Math.min(100, (b.value / max) * 100)}%`,
                    opacity: barOpacity(i, b.isToday),
                  }}
                />
              )}
            </span>
            <span className="iki-vbar-day" data-today={b.isToday}>
              {b.letter}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
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
  const today = todayUTC();

  return (
    <div className="flex w-full max-w-xl flex-col gap-stack">
      {/* Written out rather than using PageHeader, whose tracking and title
          size predate the token scale. That component still serves the screens
          this restyle has not reached. */}
      <header className="flex flex-col gap-1.5">
        <p className="iki-eyebrow">
          Trends · {checkin.trend.count} check-in{checkin.trend.count === 1 ? "" : "s"}
        </p>
        <h1 className="iki-title">Your movement</h1>
      </header>

      {/*
        CHECK-IN TREND LEADS. Everybody has check-ins; the device cards below
        render for the few people with a ring. Training days are not counted
        here: the Training card reconciles check-ins against any device, and two
        counts of one week on one page disagree the moment a ring is connected.
      */}
      {checkin.trend.count === 0 ? (
        <section className="iki-card">
          <p className="text-body-sm text-muted">
            Check in daily and your energy &amp; sleep trend will build here.
          </p>
        </section>
      ) : (
        <>
          <WeekCard
            icon="flame"
            glyphClass="bg-primary text-primary-fg"
            eyebrow="Energy · 7d"
            value={checkin.trend.avgEnergy}
            delta={checkin.trend.energyDelta}
            deltaClass={(checkin.trend.energyDelta ?? 0) < 0 ? "text-muted" : "font-semibold text-primary"}
            bars={weekBars(checkin.series, (p) => p.energy_score, today)}
            max={5}
            kind="primary"
            label="Energy for each of the last seven days"
          />
          <WeekCard
            icon="moon"
            glyphClass="bg-pillar-recovery"
            eyebrow="Sleep · 7d"
            value={checkin.trend.avgSleep}
            unit="h"
            delta={checkin.trend.sleepDelta}
            deltaClass={(checkin.trend.sleepDelta ?? 0) < 0 ? "text-muted" : "font-semibold text-pillar-recovery"}
            bars={weekBars(checkin.series, (p) => p.sleep_hours, today)}
            max={9}
            kind="recovery"
            label="Sleep for each of the last seven days"
          />
        </>
      )}

      {/* Since your baseline: the infrequent, high-value signal, led by the
          reward when there is one. */}
      <section className="iki-card flex flex-col gap-3">
        <p className="iki-eyebrow">Since your baseline</p>
        {bonuses.length > 0 &&
          (() => {
            const p = insightParts(bonuses[0], biomarker.baselineDate);
            return (
              <p className="iki-insight">
                {p.lead} <span className="text-muted">{p.middle}</span>{" "}
                <span className="text-primary">{p.reward}</span>
              </p>
            );
          })()}
        {bonuses.length > 1 && (
          <ul className="flex flex-col gap-1">
            {bonuses.slice(1).map((b, i) => (
              <li key={i} className="text-body-sm text-ink">
                <span className="font-semibold">{markerLabel(b)}</span> moved into range,{" "}
                <span className="font-semibold text-primary">+{b.amount} iki</span>
              </li>
            ))}
          </ul>
        )}
        {biomarker.panelCount < 2 ? (
          <p className="text-body-sm text-muted">
            You have one lab panel so far. Lab work is usually months apart. When you
            upload your next panel you&rsquo;ll see exactly which markers moved, and earn
            iki points for any that improve into range.
          </p>
        ) : (
          <>
            <ul className="flex flex-col">
              {biomarker.deltas.slice(0, 12).map((d) => (
                <li
                  key={d.marker_key}
                  className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0"
                >
                  <span className="h-2 w-2 shrink-0 rounded-pill bg-pillar-longevity" aria-hidden />
                  <span className="min-w-0 flex-1 text-body font-semibold text-ink">
                    {d.marker_name ?? d.marker_key}
                  </span>
                  {(d.moved_into_range || d.improved) && (
                    <span className="iki-badge iki-flag-good shrink-0">
                      {d.moved_into_range ? "Into range" : "Improved"}
                    </span>
                  )}
                  {/* Never wrapped: "24 → 31" split over two lines reads as
                      two unrelated numbers rather than one movement. Direction
                      of "good" varies per marker, so the numbers stay neutral;
                      the pill is the health signal. */}
                  <span className="shrink-0 whitespace-nowrap text-caption text-muted">
                    {d.baseline_value} → <strong className="font-semibold text-ink">{d.latest_value}</strong>
                  </span>
                </li>
              ))}
            </ul>
            {biomarker.baselineDate && biomarker.latestDate && (
              <p className="text-micro uppercase tracking-[0.1em] text-muted">
                {formatPanelDate(biomarker.baselineDate)} → {formatPanelDate(biomarker.latestDate)}
              </p>
            )}
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
