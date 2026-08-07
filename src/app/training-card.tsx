"use client";

import { useCallback, useEffect, useState } from "react";

import type { RecoverySignal, TrainingLoad } from "@/lib/training";
import { Card, Eyebrow } from "./ui";

/**
 * "Training and recovery" in Trends.
 *
 * WHAT IT IS FOR. Everything else on this page is about what your body is,
 * from a check-in or a lab panel. This is the one card about what you did to
 * it, and whether it is absorbing that.
 *
 * IT DOES NOT CLAIM A BIOMARKER LINK, because there is not one we can show.
 * Training moves markers slowly and indirectly, through eating and sleeping and
 * recovery, over a panel cycle of roughly six months. Proving it needs paired
 * training and panel data nobody has yet, ours included. So this card describes
 * the week and stops, and the copy is written so that no reasonable person
 * reads a promise into it.
 *
 * IT NEVER GIVES ADVICE. No "take a rest day", no "you are overtraining". The
 * signal says what moved and against what. What to do about it is between the
 * person and their doctor, and an app is not qualified to be in that sentence.
 *
 * THE SOURCE IS ALWAYS ON SCREEN. A number from a ring and a number from a
 * duration chip are different kinds of fact, and the card says which it is
 * showing rather than letting an estimate borrow a device's credibility.
 */

interface Payload {
  window: { days: number; endDate: string };
  load: TrainingLoad;
  recovery: RecoverySignal;
}

/** Minutes as people say them: "45m", "1h 20m", "2h". */
function readableMinutes(total: number): string {
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * The colour of a recovery direction.
 *
 * "straining" is deliberately NOT red. It is a description of a hard week, and
 * a hard week is often exactly what somebody intended; painting it as an error
 * state turns a neutral observation into a telling-off.
 */
const DIRECTION_TONE: Record<RecoverySignal["direction"], string> = {
  recovering: "text-clay",
  holding: "text-foreground",
  straining: "text-accent",
  unknown: "text-muted",
};

const DIRECTION_LABEL: Record<RecoverySignal["direction"], string> = {
  recovering: "Recovering",
  holding: "Holding steady",
  straining: "Under load",
  unknown: "Not enough data",
};

/**
 * Where the week's numbers came from, said plainly.
 *
 * Reads the list rather than assuming a default. The first version fell
 * through to the check-in wording whenever `sources` was not exactly
 * `["device"]`, which told somebody whose week was entirely device-recorded
 * walks that they had typed it in themselves.
 */
function sourceNote(load: TrainingLoad): string | null {
  const checkin = load.sources.includes("checkin");
  const device = load.sources.includes("device");
  if (checkin && device) return "From your check-ins and your connected device";
  if (device) return "From your connected device";
  if (checkin) return "From what you logged at check-in";
  return null;
}

export function TrainingCard({ getToken }: { getToken: () => Promise<string | null> }) {
  const [data, setData] = useState<Payload | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/training", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setData((await res.json()) as Payload);
    } catch {
      /* Trends must render with or without this card */
    }
  }, [getToken]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  if (!data) return null;

  const { load: week, recovery, window } = data;

  // Nothing trained, nothing walked and nothing to say about recovery: show
  // nothing at all rather than a card of zeroes. A week off is not a failure to
  // display back at somebody, and an empty card on the page you check daily is
  // just noise.
  if (week.days === 0 && week.movement.sessions === 0 && recovery.direction === "unknown") {
    return null;
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <Eyebrow>Training &amp; recovery</Eyebrow>
        <p className="font-body text-xs text-muted">Last {window.days} days</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-body text-xs text-muted">Training days</span>
          <span className="font-display text-2xl font-medium text-foreground">
            {week.days}
            <span className="ml-1 font-body text-xs text-muted">/ {window.days}</span>
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-body text-xs text-muted">Time</span>
          <span className="font-display text-2xl font-medium text-foreground">
            {week.minutes > 0 ? readableMinutes(week.minutes) : "-"}
          </span>
          {/* "about" is load-bearing. A duration chip is a bucket we turned
              into a number on the user's behalf, and a total built from those
              must not look like a stopwatch reading. */}
          {week.minutesEstimated && week.minutes > 0 && (
            <span className="font-body text-[0.7rem] text-muted">approximate</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-body text-xs text-muted">Rest days</span>
          <span className="font-display text-2xl font-medium text-foreground">
            {week.restDays}
          </span>
        </div>
      </div>

      {week.activities.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {week.activities.slice(0, 6).map((a) => (
            <span
              key={a.toLowerCase()}
              className="rounded-pill border border-border px-3 py-1 font-body text-xs text-foreground/80"
            >
              {a}
            </span>
          ))}
        </div>
      )}

      {/* MOVEMENT, KEPT VISIBLY APART FROM TRAINING. A watch logging a walk to
          the station is real and worth showing: everyday movement acts on
          bone, muscle, gut and metabolic health, and this app is a wellness
          picture rather than a gym log. It is also not a workout, and adding
          it to the training count would hand somebody seven training days for
          a week they trained none. So: its own line, its own words, never
          summed into the numbers above. */}
      {week.movement.sessions > 0 && (
        <p className="font-body text-xs text-muted">
          Your device also picked up{" "}
          <span className="text-foreground">
            {week.movement.sessions} movement session
            {week.movement.sessions === 1 ? "" : "s"}
          </span>
          {week.movement.minutes > 0 && `, ${readableMinutes(week.movement.minutes)}`}, on{" "}
          {week.movement.days} day{week.movement.days === 1 ? "" : "s"}. Walking and
          everyday movement count for your health; they are kept separate here
          because they are not training.
        </p>
      )}

      {recovery.direction !== "unknown" && (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-body text-xs text-muted">Recovery</span>
            <span className={`font-body text-sm font-medium ${DIRECTION_TONE[recovery.direction]}`}>
              {DIRECTION_LABEL[recovery.direction]}
            </span>
          </div>
          <p className="font-body text-sm text-foreground/80">{recovery.summary}</p>
          <p className="font-body text-[0.7rem] text-muted">
            {/* Two different kinds of claim, and the card says which one it is
                making. Self-report drifts with mood; a ring does not, and
                letting the first borrow the credibility of the second is the
                easiest dishonesty available to a health app. */}
            {recovery.source === "measured"
              ? "Measured by your device, against your own baseline"
              : "Based on how you have reported feeling, not a device reading"}
          </p>
        </div>
      )}

      <p className="font-body text-[0.7rem] text-muted">
        {sourceNote(week) ? `${sourceNote(week)}. ` : ""}
        Training supports bone, muscle and metabolic health over months, so this is
        a record of the work, not a prediction about your next panel.
      </p>
    </Card>
  );
}
