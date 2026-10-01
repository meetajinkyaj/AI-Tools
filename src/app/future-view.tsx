"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { POINTS } from "@/lib/points";
import { signed } from "@/lib/week-bars";
import { Rings } from "./data-marks";
import { Icon } from "./icons";


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

interface Outlook {
  checkedInToday: boolean;
  checkinsThisMonth: number;
  changeThisMonth: number | null;
  projectedIfCheckedIn: number | null;
}

interface FutureData {
  momentum: Momentum;
  /** v2; optional so an older API response still renders. */
  outlook?: Outlook;
  markers: MarkerOutlook[];
  inRangeCount: number;
  retest: Retest | null;
  panelCount: number;
  interventions: InterventionRow[];
}

const DISCLAIMER = "Educational, not a diagnosis. Please consult a doctor.";

/*
 * Three outlooks, as a word in a hue (v2 section 4.5). Longevity blue for the
 * one the member is moving, muted for holding, and the performance hue with a
 * dashed ring for "needs inputs", which is an absence of data rather than a
 * verdict about the body. None of them is red.
 */
const OUTLOOK_META: Record<MarkerOutlook["outlook"], { label: string; cls: string }> = {
  improving: { label: "Improving", cls: "text-pillar-longevity" },
  holding: { label: "Holding", cls: "text-muted" },
  needs_inputs: { label: "Needs inputs", cls: "text-pillar-performance" },
};

/** "November", from a YYYY-MM-DD, in UTC so the month cannot slip a day. */
function monthOf(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
}

/** "20 Nov", for the scoreboard. */
function dayMonthOf(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * The momentum sentence (v2 section 4.5), in three tones: ink, muted, and
 * terracotta for the number the member can move.
 *
 * COMPOSED ONLY FROM WHAT IS TRUE. The handoff's line ("Today is the biggest
 * +28 iki opportunity of your week ... ahead of pace for your November panel")
 * makes two claims nothing here computes, so the sentence keeps its shape and
 * says only what the numbers support: what today is worth, what momentum
 * becomes with today's check-in, and when the next panel is.
 */
export function momentumSentence(
  score: number,
  outlook: Outlook | undefined,
  retestDue: string | null,
): { lead: string; muted: string; figure: string | null; tail: string } {
  const panel = retestDue ? ` your ${monthOf(retestDue)} panel` : null;
  if (!outlook || outlook.checkedInToday) {
    return {
      lead: "Today is in.",
      muted: " Momentum is at",
      figure: String(score),
      tail: panel ? `, heading into${panel}.` : ".",
    };
  }
  const worth = `Today is worth +${POINTS.checkin} iki.`;
  if (outlook.projectedIfCheckedIn != null && outlook.projectedIfCheckedIn > score) {
    return {
      lead: worth,
      muted: " Check in and log training and momentum climbs to",
      figure: String(outlook.projectedIfCheckedIn),
      tail: panel ? `, ahead of${panel}.` : ".",
    };
  }
  return { lead: worth, muted: " Check in to keep your momentum where it is.", figure: null, tail: "" };
}

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
  const sig = m.signals;
  const outlook = data.outlook;
  const sentence = momentumSentence(m.score, outlook, data.retest?.dueDate ?? null);
  const monthDays = 30;
  const done = Math.min(monthDays, outlook?.checkinsThisMonth ?? Math.round(sig.checkinRate * monthDays));
  const markerTotal = data.inRangeCount + data.markers.length;
  const energyTrend =
    sig.energyDelta == null ? null : sig.energyDelta > 0 ? "up" : sig.energyDelta < 0 ? "down" : "flat";

  return (
    <div className="flex w-full max-w-xl flex-col gap-stack">
      <header className="flex flex-col gap-1.5">
        <p className="iki-eyebrow">Future You</p>
        <h1 className="iki-title">Six months out</h1>
      </header>

      {/* The engine: habit momentum. */}
      <section className="iki-card flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="iki-eyebrow">Habit momentum</p>
            <p className="font-display text-display-2xl text-ink">{m.score}</p>
            {outlook?.changeThisMonth != null && outlook.changeThisMonth !== 0 && (
              <span className="iki-delta self-start">
                <span className={outlook.changeThisMonth > 0 ? "text-primary" : "text-muted"}>
                  {signed(outlook.changeThisMonth)}
                </span>
                <span className="uppercase tracking-[0.1em] text-muted">this month</span>
              </span>
            )}
          </div>
          <Rings
            size={56}
            stroke={5}
            radii={[25.5, 18.5, 11.5]}
            rings={[
              { value: sig.trainingDaysPerWeek / 7, color: "var(--pillar-performance)" },
              { value: (sig.avgSleep ?? 0) / 9, color: "var(--pillar-recovery)" },
              {
                value: markerTotal > 0 ? data.inRangeCount / markerTotal : 0,
                color: "var(--pillar-longevity)",
              },
            ]}
            centreDot={3}
          />
        </div>

        <p className="iki-insight">
          {sentence.lead}
          <span className="text-muted">{sentence.muted}</span>
          {sentence.figure && <span className="text-primary"> {sentence.figure}</span>}
          <span className="text-muted">{sentence.tail}</span>
        </p>

        <div className="flex flex-col gap-2">
          <div
            className="iki-dots iki-dots-month"
            role="img"
            aria-label={`${done} of ${monthDays} check-ins this month`}
          >
            {Array.from({ length: monthDays }, (_, i) => (
              <span key={i} className="iki-dot" data-on={i < done} />
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="whitespace-nowrap text-micro uppercase tracking-[0.06em] text-muted" aria-hidden>
              {done} / {monthDays} check-ins this month
            </p>
            {!outlook?.checkedInToday && onCheckIn && (
              <button
                type="button"
                onClick={onCheckIn}
                className="iki-tap iki-press flex shrink-0 items-center gap-1 whitespace-nowrap text-micro font-semibold uppercase tracking-[0.06em] text-primary"
              >
                Check in today
                <Icon name="arrow-right" size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* The four inputs behind the number, as one pill. */}
      <section className="iki-card grid grid-cols-4 gap-2 rounded-pill px-5.5 py-4 text-center">
        <Stat value={`${Math.round(sig.checkinRate * 100)}%`} label="Check-ins" />
        <Stat value={sig.avgSleep != null ? `${sig.avgSleep}h` : "-"} label="Sleep" />
        <Stat value={`${sig.trainingDaysPerWeek}×`} label="Training" />
        <Stat
          value={
            energyTrend == null ? (
              "-"
            ) : (
              <Icon
                name={energyTrend === "flat" ? "arrow-right" : "arrow-up-right"}
                size={20}
                strokeWidth={1.8}
                className={
                  energyTrend === "up" ? "text-primary" : energyTrend === "down" ? "rotate-90 text-muted" : "text-muted"
                }
              />
            )
          }
          label={
            energyTrend === "up"
              ? "Energy rising"
              : energyTrend === "down"
                ? "Energy dipping"
                : energyTrend === "flat"
                  ? "Energy steady"
                  : "Energy"
          }
        />
      </section>

      {/* THE SCOREBOARD: the one card that points outside the app. A fixed
          brand photograph, identical in both themes, so what sits on it is
          fixed too (linen text, tan eyebrow, clay for the reward, which holds
          AA on the scrim where terracotta would not). */}
      {data.retest && (
        <section className="iki-photo-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed
              decorative background; next/image adds nothing on a Worker. */}
          <img src="/ikigaro-hero.jpg" alt="" className="iki-photo-card-img" />
          <div className="iki-photo-card-body">
            <p className="iki-eyebrow text-tan">The scoreboard</p>
            <p className="font-display text-display-name text-linen">
              {data.retest.daysUntilDue > 0
                ? `Next panel in ${data.retest.daysUntilDue} days`
                : "Your re-test window is open"}
            </p>
            <p className="text-caption text-photo-text">
              {data.retest.daysUntilDue > 0
                ? `Around ${dayMonthOf(data.retest.dueDate)}, a re-test shows what these months actually did. `
                : `It's been six months since your ${dayMonthOf(data.retest.lastPanelDate)} panel. A re-test now shows what your habits did. `}
              <span className="font-semibold text-clay">+{POINTS.reTestUpload} iki</span> on upload.
            </p>
          </div>
        </section>
      )}

      {/* The outcome layer: where flagged markers are headed. */}
      <section className="iki-card flex flex-col">
        <p className="iki-eyebrow pb-2">Where your markers point</p>
        {data.markers.length > 0 ? (
          <>
            <ul className="flex flex-col">
              {data.markers.map((mk) => {
                const meta = OUTLOOK_META[mk.outlook];
                return (
                  <li key={mk.marker_key} className="flex items-center gap-3 border-t border-line py-2.5">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-body font-semibold text-ink">
                        {mk.marker_name ?? mk.marker_key}
                      </span>
                      <span className="text-micro text-muted">
                        {mk.model === "linear_v1" && mk.projected_value != null && mk.projection_date
                          ? `${mk.current_value ?? "-"} → ~${mk.projected_value} by ${monthOf(mk.projection_date).slice(0, 3)}`
                          : `now ${mk.current_value ?? "-"}`}
                      </span>
                    </div>
                    <span className={`flex shrink-0 items-center gap-1.5 text-small font-semibold ${meta.cls}`}>
                      {mk.outlook === "needs_inputs" && <span className="iki-dashed-ring" aria-hidden />}
                      {meta.label}
                      {mk.outlook === "improving" && <Icon name="arrow-up-right" size={12} strokeWidth={2} />}
                      {mk.outlook === "holding" && <Icon name="arrow-right" size={12} strokeWidth={2} />}
                    </span>
                  </li>
                );
              })}
            </ul>
            {data.inRangeCount > 0 && (
              <p className="border-t border-line pt-2.5 text-micro text-muted">
                The other {data.inRangeCount} markers are in range. Momentum keeps them there.
              </p>
            )}
          </>
        ) : (
          <p className="text-body-sm text-ink">
            Everything on your last panel was in range. The goal for the next six
            months: keep it that way, momentum is how.
          </p>
        )}
      </section>

      {/* The running experiment. */}
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

      <p className="text-micro text-muted">
        Directional and motivational, not a prediction of your actual results.{" "}
        {DISCLAIMER}
      </p>
    </div>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <span className="flex h-7 items-center font-display text-display-sm text-ink">{value}</span>
      <span className="truncate text-eyebrow-sm tracking-normal text-muted">{label}</span>
    </div>
  );
}

function dayOf(startedAt: string): number {
  const days = Math.floor((Date.now() - Date.parse(startedAt)) / 86_400_000) + 1;
  return Math.max(1, days);
}
