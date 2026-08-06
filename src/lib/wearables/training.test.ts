import { describe, expect, it } from "vitest";

import { mergeMetrics, type MergedSeries, type MetricRow } from "./merge";
import { recoverySignal, trainingLoad, type WorkoutRow } from "./training";

/**
 * The near half of the training thesis, which is the half that can be shown.
 *
 * The far half, training moving a biomarker, needs paired training and panel
 * data six months apart that nobody has yet. Nothing here claims it, and these
 * tests exist partly to keep it that way.
 */

const w = (
  date: string,
  startHour: number,
  minutes: number,
  activity?: string,
): WorkoutRow => ({
  workout_date: date,
  started_at: `${date}T${String(startHour).padStart(2, "0")}:00:00Z`,
  ended_at: `${date}T${String(startHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`,
  activity,
  provider: "whoop",
});

describe("trainingLoad", () => {
  it("counts DAYS separately from sessions", () => {
    // The number people mean by "I trained four times this week" is days. Two
    // sessions on one day is one training day, and reporting it as two would
    // flatter the figure in exactly the way a habit app must not.
    const load = trainingLoad(
      [w("2026-08-04", 7, 45, "running"), w("2026-08-04", 18, 30, "strength")],
      "2026-08-07",
    );
    expect(load.sessions).toBe(2);
    expect(load.days).toBe(1);
    expect(load.minutes).toBe(75);
  });

  it("counts rest days from the window, not from the sessions", () => {
    const load = trainingLoad([w("2026-08-07", 7, 40)], "2026-08-07");
    expect(load.restDays).toBe(6);
  });

  it("ranks activities by how often they appear", () => {
    const load = trainingLoad(
      [
        w("2026-08-01", 7, 30, "running"),
        w("2026-08-02", 7, 30, "padel"),
        w("2026-08-03", 7, 30, "running"),
      ],
      "2026-08-07",
    );
    expect(load.activities).toEqual(["running", "padel"]);
  });

  it("ignores sessions outside the window", () => {
    const load = trainingLoad(
      [w("2026-08-07", 7, 30), w("2026-06-01", 7, 30)],
      "2026-08-07",
    );
    expect(load.sessions).toBe(1);
  });

  it("returns a full rest week rather than throwing on no data", () => {
    const load = trainingLoad([], "2026-08-07");
    expect(load).toMatchObject({ sessions: 0, days: 0, minutes: 0, restDays: 7 });
  });

  it("survives a malformed timestamp instead of producing NaN minutes", () => {
    const load = trainingLoad(
      [{ ...w("2026-08-07", 7, 30), ended_at: "not-a-date" }],
      "2026-08-07",
    );
    expect(load.sessions).toBe(1);
    expect(load.minutes).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

/** Builds a merged series map with `days` days of a constant value, ending at `end`. */
function seriesFor(
  spec: Record<string, [recent: number, prior: number]>,
): Map<string, MergedSeries> {
  const rows: MetricRow[] = [];
  for (const [metric, [recent, prior]] of Object.entries(spec)) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.parse("2026-08-14T00:00:00Z") - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      rows.push({ provider: "oura", metric_date: d, metric, value: recent });
    }
    for (let i = 7; i < 14; i++) {
      const d = new Date(Date.parse("2026-08-14T00:00:00Z") - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      rows.push({ provider: "oura", metric_date: d, metric, value: prior });
    }
  }
  return new Map(mergeMetrics(rows).map((s) => [s.metric, s]));
}

describe("recoverySignal", () => {
  const END = "2026-08-14";

  it("needs two markers to agree before saying anything", () => {
    // HRV alone swings with alcohol, illness and a late meal. One marker is
    // noise, and a body signal that fires on noise stops being read.
    const only = seriesFor({ hrv: [70, 50] });
    expect(recoverySignal(only, END).direction).toBe("unknown");
  });

  it("calls it recovering when HRV rises and resting heart rate falls", () => {
    const s = seriesFor({ hrv: [70, 50], resting_heart_rate: [50, 58] });
    const out = recoverySignal(s, END);
    expect(out.direction).toBe("recovering");
    expect(out.basis).toEqual(["HRV", "resting heart rate"]);
  });

  it("calls it straining when they move the other way", () => {
    const s = seriesFor({ hrv: [45, 62], resting_heart_rate: [60, 51] });
    expect(recoverySignal(s, END).direction).toBe("straining");
  });

  it("calls it holding when nothing moved much", () => {
    // 1% and 1% are inside both thresholds, so neither votes.
    const s = seriesFor({ hrv: [50.5, 50], resting_heart_rate: [51, 51.5] });
    expect(recoverySignal(s, END).direction).toBe("holding");
  });

  it("judges against the person's own baseline, not a population range", () => {
    // A resting heart rate of 58 is unremarkable in the abstract, and means
    // something when yours is normally 51.
    const s = seriesFor({ hrv: [40, 55], resting_heart_rate: [58, 51] });
    expect(recoverySignal(s, END).direction).toBe("straining");

    // The same 58 as a steady state says nothing at all.
    const steady = seriesFor({ hrv: [50, 50], resting_heart_rate: [58, 58] });
    expect(recoverySignal(steady, END).direction).toBe("holding");
  });

  it("says it does not know rather than guessing, with no data", () => {
    const out = recoverySignal(new Map(), END);
    expect(out.direction).toBe("unknown");
    expect(out.basis).toEqual([]);
  });

  it("never gives advice, only description", () => {
    // A health app telling somebody to rest is making a recommendation it is
    // not qualified to make. Every summary describes what happened.
    const cases = [
      seriesFor({ hrv: [70, 50], resting_heart_rate: [50, 58] }),
      seriesFor({ hrv: [45, 62], resting_heart_rate: [60, 51] }),
      seriesFor({ hrv: [50.5, 50], resting_heart_rate: [51, 51.5] }),
      new Map<string, MergedSeries>(),
    ];
    for (const c of cases) {
      const s = recoverySignal(c, END).summary.toLowerCase();
      for (const word of ["should", "take a", "rest day", "you need", "recommend"]) {
        expect(s, s).not.toContain(word);
      }
    }
  });
});
