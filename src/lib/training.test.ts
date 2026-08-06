import { describe, expect, it } from "vitest";

import {
  type CheckinTrainingRow,
  recoverySignal,
  recoveryView,
  reportedRecovery,
  trainingLoad,
  type WorkoutRow,
} from "./training";
import { mergeMetrics, type MergedSeries, type MetricRow } from "./wearables/merge";

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

/** A check-in that logged activities. */
const c = (
  date: string,
  exercises: { type: string; duration?: string | null; label?: string }[],
): CheckinTrainingRow => ({
  checkin_date: date,
  training_logged: exercises.length > 0,
  exercises: exercises.map((e) => ({
    type: e.type,
    label: e.label ?? null,
    // The cast mirrors what arrives from the database: jsonb, unvalidated at
    // the type level, which is exactly why the module re-checks the bucket.
    duration: (e.duration ?? null) as never,
  })),
});

describe("trainingLoad, from device sessions", () => {
  it("counts DAYS separately from sessions", () => {
    // The number people mean by "I trained four times this week" is days. Two
    // sessions on one day is one training day, and reporting it as two would
    // flatter the figure in exactly the way a habit app must not.
    const load = trainingLoad(
      { workouts: [w("2026-08-04", 7, 45, "running"), w("2026-08-04", 18, 30, "strength")] },
      "2026-08-07",
    );
    expect(load.sessions).toBe(2);
    expect(load.days).toBe(1);
    expect(load.minutes).toBe(75);
  });

  it("counts rest days from the window, not from the sessions", () => {
    const load = trainingLoad({ workouts: [w("2026-08-07", 7, 40)] }, "2026-08-07");
    expect(load.restDays).toBe(6);
  });

  it("ranks activities by how often they appear", () => {
    const load = trainingLoad(
      {
        workouts: [
          w("2026-08-01", 7, 30, "running"),
          w("2026-08-02", 7, 30, "padel"),
          w("2026-08-03", 7, 30, "running"),
        ],
      },
      "2026-08-07",
    );
    expect(load.activities).toEqual(["running", "padel"]);
  });

  it("ignores sessions outside the window", () => {
    const load = trainingLoad(
      { workouts: [w("2026-08-07", 7, 30), w("2026-06-01", 7, 30)] },
      "2026-08-07",
    );
    expect(load.sessions).toBe(1);
  });

  it("returns a full rest week rather than throwing on no data", () => {
    const load = trainingLoad({}, "2026-08-07");
    expect(load).toMatchObject({ sessions: 0, days: 0, minutes: 0, restDays: 7 });
    expect(load.sources).toEqual([]);
  });

  it("survives a malformed timestamp instead of producing NaN minutes", () => {
    const load = trainingLoad(
      { workouts: [{ ...w("2026-08-07", 7, 30), ended_at: "not-a-date" }] },
      "2026-08-07",
    );
    expect(load.sessions).toBe(1);
    expect(load.minutes).toBe(0);
  });

  it("marks measured minutes as not estimated", () => {
    const load = trainingLoad({ workouts: [w("2026-08-07", 7, 45)] }, "2026-08-07");
    expect(load.minutesEstimated).toBe(false);
    expect(load.sources).toEqual(["device"]);
  });
});

describe("trainingLoad, from check-ins", () => {
  it("reads the check-in on its own, with no device connected", () => {
    // This is the case that matters most today: nobody in the beta has a ring,
    // and a card that needs one renders for nobody.
    const load = trainingLoad(
      {
        checkins: [
          c("2026-08-05", [{ type: "gym", duration: "medium" }]),
          c("2026-08-07", [{ type: "running", duration: "short" }]),
        ],
      },
      "2026-08-07",
    );
    expect(load.days).toBe(2);
    expect(load.sessions).toBe(2);
    expect(load.minutes).toBe(65); // medium 45 + short 20
    expect(load.minutesEstimated).toBe(true);
    expect(load.sources).toEqual(["checkin"]);
  });

  it("shows the human label, not the storage key", () => {
    const load = trainingLoad(
      { checkins: [c("2026-08-07", [{ type: "yoga_mobility", duration: "short" }])] },
      "2026-08-07",
    );
    expect(load.activities).toEqual(["Yoga / Pilates / Mobility"]);
  });

  it("carries the free text of an 'other' activity through", () => {
    const load = trainingLoad(
      { checkins: [c("2026-08-07", [{ type: "other", label: "Kabaddi", duration: "long" }])] },
      "2026-08-07",
    );
    expect(load.activities).toEqual(["Kabaddi"]);
    expect(load.minutes).toBe(75);
  });

  it("counts a bare training_logged day, from before activity chips existed", () => {
    // Migration 0003 added the chips; check-ins written before it have the tick
    // box and nothing else. Dropping them would erase real training history.
    const load = trainingLoad(
      { checkins: [{ checkin_date: "2026-08-07", training_logged: true, exercises: [] }] },
      "2026-08-07",
    );
    expect(load.days).toBe(1);
    expect(load.sessions).toBe(1);
    expect(load.minutes).toBe(0);
  });

  it("does not count a check-in that logged no training", () => {
    const load = trainingLoad(
      { checkins: [{ checkin_date: "2026-08-07", training_logged: false, exercises: [] }] },
      "2026-08-07",
    );
    expect(load.days).toBe(0);
    expect(load.restDays).toBe(7);
  });

  it("counts an activity with no duration as a session worth zero minutes", () => {
    // Inventing a median would put a number on the screen the user never gave
    // us, and it would be indistinguishable from one they did.
    const load = trainingLoad({ checkins: [c("2026-08-07", [{ type: "gym" }])] }, "2026-08-07");
    expect(load.sessions).toBe(1);
    expect(load.minutes).toBe(0);
    expect(load.minutesEstimated).toBe(false);
  });

  it("ignores a duration bucket it does not recognise", () => {
    const load = trainingLoad(
      { checkins: [c("2026-08-07", [{ type: "gym", duration: "enormous" }])] },
      "2026-08-07",
    );
    expect(load.minutes).toBe(0);
  });
});

describe("trainingLoad, reconciling the two sources", () => {
  it("does not count one day twice when both sources saw it", () => {
    // Somebody who logs "gym" and whose ring records the same hour trained
    // once. Summing the sources would tell them they trained twice, and that
    // is the single most damaging thing this function could get wrong.
    const load = trainingLoad(
      {
        workouts: [w("2026-08-07", 7, 50, "Weight Training")],
        checkins: [c("2026-08-07", [{ type: "gym", duration: "long" }])],
      },
      "2026-08-07",
    );
    expect(load.days).toBe(1);
    expect(load.sessions).toBe(1);
    expect(load.sources).toEqual(["checkin", "device"]);
  });

  it("prefers measured minutes over the estimated bucket on a shared day", () => {
    // The bucket says 75; the ring says 50. Prefer whatever measured the
    // quantity directly, which is the rule the biomarker merge already uses.
    const load = trainingLoad(
      {
        workouts: [w("2026-08-07", 7, 50, "Weight Training")],
        checkins: [c("2026-08-07", [{ type: "gym", duration: "long" }])],
      },
      "2026-08-07",
    );
    expect(load.minutes).toBe(50);
    expect(load.minutesEstimated).toBe(false);
  });

  it("takes the fuller session count when the two disagree", () => {
    // The ring caught two sessions; the check-in remembered one. Two happened.
    const load = trainingLoad(
      {
        workouts: [w("2026-08-07", 7, 40, "running"), w("2026-08-07", 18, 30, "cycling")],
        checkins: [c("2026-08-07", [{ type: "running", duration: "medium" }])],
      },
      "2026-08-07",
    );
    expect(load.sessions).toBe(2);
    expect(load.days).toBe(1);
  });

  it("estimates only the days the device did not cover", () => {
    const load = trainingLoad(
      {
        workouts: [w("2026-08-07", 7, 50)],
        checkins: [c("2026-08-05", [{ type: "gym", duration: "medium" }])],
      },
      "2026-08-07",
    );
    expect(load.minutes).toBe(95); // 50 measured + 45 estimated
    expect(load.minutesEstimated).toBe(true);
    expect(load.days).toBe(2);
  });

  it("lists both activities when a day held two different ones", () => {
    const load = trainingLoad(
      {
        workouts: [w("2026-08-07", 7, 40, "Running")],
        checkins: [c("2026-08-07", [{ type: "gym", duration: "short" }])],
      },
      "2026-08-07",
    );
    expect(load.activities).toContain("Running");
    expect(load.activities).toContain("Gym / Weights");
  });
});

/* -------------------------------------------------------------------------- */

/** Builds a merged series map with a fortnight of data ending 2026-08-14. */
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
    expect(out.source).toBe("measured");
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
    expect(out.source).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

/** `n` consecutive check-ins ending at `end`, all carrying the same numbers. */
function checkinRun(
  end: string,
  n: number,
  energy: number,
  sleep?: number,
): CheckinTrainingRow[] {
  const out: CheckinTrainingRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      checkin_date: new Date(Date.parse(`${end}T00:00:00Z`) - i * 86_400_000)
        .toISOString()
        .slice(0, 10),
      energy_score: energy,
      sleep_hours: sleep ?? null,
    });
  }
  return out;
}

describe("reportedRecovery", () => {
  const END = "2026-08-14";
  const PRIOR_END = "2026-08-07";

  it("reads energy alone, because energy is the reported measure not a proxy", () => {
    const rows = [...checkinRun(END, 7, 4.5), ...checkinRun(PRIOR_END, 7, 3)];
    const out = reportedRecovery(rows, END);
    expect(out.direction).toBe("recovering");
    expect(out.source).toBe("reported");
    expect(out.basis).toEqual(["energy"]);
  });

  it("says straining when reported energy drops", () => {
    const rows = [...checkinRun(END, 7, 2.5), ...checkinRun(PRIOR_END, 7, 4)];
    expect(reportedRecovery(rows, END).direction).toBe("straining");
  });

  it("holds when energy barely moved", () => {
    // 0.2 of a point is inside the threshold: the difference between "Okay"
    // and "Okay on a slightly better morning".
    const rows = [...checkinRun(END, 7, 3.2), ...checkinRun(PRIOR_END, 7, 3)];
    expect(reportedRecovery(rows, END).direction).toBe("holding");
  });

  it("lets sleep cancel energy rather than confirm it blindly", () => {
    const rows = [...checkinRun(END, 7, 4, 5.5), ...checkinRun(PRIOR_END, 7, 3, 7.5)];
    expect(reportedRecovery(rows, END).direction).toBe("holding");
  });

  it("names sleep in the basis when it agreed", () => {
    const rows = [...checkinRun(END, 7, 4, 8), ...checkinRun(PRIOR_END, 7, 3, 6.5)];
    const out = reportedRecovery(rows, END);
    expect(out.direction).toBe("recovering");
    expect(out.basis).toEqual(["energy", "sleep"]);
  });

  it("refuses to compare when a window is too thin", () => {
    // Three days against seven is not a baseline, it is a mood.
    const rows = [...checkinRun(END, 3, 5), ...checkinRun(PRIOR_END, 7, 3)];
    expect(reportedRecovery(rows, END).direction).toBe("unknown");
  });

  it("reads sleep given as a string, which is how numeric arrives over PostgREST", () => {
    const rows = [
      ...checkinRun(END, 7, 4).map((r) => ({ ...r, sleep_hours: "8.0" })),
      ...checkinRun(PRIOR_END, 7, 3).map((r) => ({ ...r, sleep_hours: "6.0" })),
    ];
    expect(reportedRecovery(rows, END).basis).toEqual(["energy", "sleep"]);
  });
});

type RecoveryCase = [Map<string, MergedSeries>, CheckinTrainingRow[]];

describe("recoveryView", () => {
  const END = "2026-08-14";
  const PRIOR_END = "2026-08-07";

  it("prefers the device when it can answer", () => {
    const measured = seriesFor({ hrv: [70, 50], resting_heart_rate: [50, 58] });
    // Check-ins pointing the other way, which must not win.
    const rows = [...checkinRun(END, 7, 2), ...checkinRun(PRIOR_END, 7, 4.5)];
    const out = recoveryView(measured, rows, END);
    expect(out.source).toBe("measured");
    expect(out.direction).toBe("recovering");
  });

  it("falls back to the check-in when no device can answer", () => {
    const rows = [...checkinRun(END, 7, 4.5), ...checkinRun(PRIOR_END, 7, 3)];
    const out = recoveryView(new Map(), rows, END);
    expect(out.source).toBe("reported");
    expect(out.direction).toBe("recovering");
  });

  it("says it does not know when neither can", () => {
    expect(recoveryView(new Map(), [], END).direction).toBe("unknown");
  });

  it("never gives advice, only description", () => {
    // A health app telling somebody to rest is making a recommendation it is
    // not qualified to make. Every summary describes what happened.
    const cases: RecoveryCase[] = [
      [seriesFor({ hrv: [70, 50], resting_heart_rate: [50, 58] }), []],
      [seriesFor({ hrv: [45, 62], resting_heart_rate: [60, 51] }), []],
      [seriesFor({ hrv: [50.5, 50], resting_heart_rate: [51, 51.5] }), []],
      [new Map(), [...checkinRun(END, 7, 4.5), ...checkinRun(PRIOR_END, 7, 3)]],
      [new Map(), [...checkinRun(END, 7, 2), ...checkinRun(PRIOR_END, 7, 4)]],
      [new Map(), []],
    ];
    for (const [series, rows] of cases) {
      const s = recoveryView(series, rows, END).summary.toLowerCase();
      for (const word of ["should", "take a", "rest day", "you need", "recommend"]) {
        expect(s, s).not.toContain(word);
      }
    }
  });
});
