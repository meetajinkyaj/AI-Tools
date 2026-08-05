import { describe, expect, it } from "vitest";

import { POINTS } from "./points";

import {
  type CheckinPoint,
  computeOutcomeAwards,
  daysBetween,
  diffPanels,
  type PanelSnapshot,
  summarizeCheckins,
} from "./trends";

const prev: PanelSnapshot = {
  date: "2026-01-01",
  readings: [
    { marker_key: "hba1c", marker_name: "HbA1c", value: 5.9, flag: "high", direction: "lower_better" },
    { marker_key: "ldl_c", marker_name: "LDL", value: 165, flag: "high", direction: "lower_better" },
    { marker_key: "hdl_c", marker_name: "HDL", value: 66, flag: "in_range", direction: "higher_better" },
  ],
};
const latest: PanelSnapshot = {
  date: "2026-05-01", // 120 days later
  readings: [
    { marker_key: "hba1c", marker_name: "HbA1c", value: 5.4, flag: "in_range", direction: "lower_better" }, // improved into range
    { marker_key: "ldl_c", marker_name: "LDL", value: 150, flag: "high", direction: "lower_better" }, // better, still high, now rewarded
    { marker_key: "hdl_c", marker_name: "HDL", value: 66.5, flag: "in_range", direction: "higher_better" }, // <1% move, noise
  ],
};

describe("daysBetween", () => {
  it("counts whole days regardless of order", () => {
    expect(daysBetween("2026-01-01", "2026-05-01")).toBe(120);
    expect(daysBetween("2026-05-01", "2026-01-01")).toBe(120);
  });
});

describe("computeOutcomeAwards", () => {
  it("rewards healthy-direction improvement, including still-flagged and continued gains", () => {
    const awards = computeOutcomeAwards(prev, latest);
    // hba1c (5.9->5.4) and ldl (165->150) both improved >5%; hdl move is noise.
    expect(awards.map((a) => a.marker_key).sort()).toEqual(["hba1c", "ldl_c"]);
    // From POINTS, so a reprice of the outcome bonus does not fail this test.
    expect(awards.every((a) => a.points === POINTS.outcomeBonusPerMarker)).toBe(true);
  });

  it("keeps rewarding continued improvement past the range boundary (visceral fat 9→8→6.5)", () => {
    const opts = { minDays: 14 };
    const p1 = { date: "2026-01-01", readings: [mk("visceral_fat", 9, "high")] };
    const p2 = { date: "2026-02-01", readings: [mk("visceral_fat", 8, "in_range")] };
    const p3 = { date: "2026-03-01", readings: [mk("visceral_fat", 6.5, "in_range")] };
    expect(computeOutcomeAwards(p1, p2, opts)).toHaveLength(1); // 9->8, into range
    expect(computeOutcomeAwards(p2, p3, opts)).toHaveLength(1); // 8->6.5, still rewarded
  });

  it("does not reward noise (a sub-threshold move)", () => {
    const p1 = { date: "2026-01-01", readings: [mk("ldl_c", 100, "in_range")] };
    const p2 = { date: "2026-02-01", readings: [mk("ldl_c", 99, "in_range")] }; // 1% < 5%
    expect(computeOutcomeAwards(p1, p2)).toEqual([]);
  });

  it("accepts but does not reward panels closer than the bi-weekly floor", () => {
    const soon: PanelSnapshot = { ...latest, date: "2026-01-10" }; // 9 days
    expect(computeOutcomeAwards(prev, soon)).toEqual([]);
  });

  it("caps the number of rewarded markers", () => {
    const manyPrev: PanelSnapshot = {
      date: "2026-01-01",
      readings: ["a", "b", "c", "d"].map((k) => mk(k, 10, "high")),
    };
    const manyLatest: PanelSnapshot = {
      date: "2026-06-01",
      readings: ["a", "b", "c", "d"].map((k) => mk(k, 1, "in_range")),
    };
    expect(computeOutcomeAwards(manyPrev, manyLatest)).toHaveLength(3);
  });
});

function mk(marker_key: string, value: number, flag: string) {
  return { marker_key, value, flag, direction: "lower_better" };
}

describe("diffPanels", () => {
  it("computes per-marker baseline→latest deltas and into-range moves", () => {
    const deltas = diffPanels(prev, latest);
    const byKey = new Map(deltas.map((d) => [d.marker_key, d]));
    expect(byKey.get("hba1c")?.delta).toBe(-0.5);
    expect(byKey.get("hba1c")?.moved_into_range).toBe(true);
    expect(byKey.get("ldl_c")?.moved_into_range).toBe(false);
    expect(byKey.get("ldl_c")?.delta).toBe(-15);
  });
});

describe("summarizeCheckins", () => {
  it("averages the recent window and the change vs the prior window", () => {
    // 14 days: recent 7 avg energy 4, prior 7 avg energy 3.
    const points: CheckinPoint[] = [];
    for (let i = 0; i < 7; i++) {
      points.push({ checkin_date: `2026-05-${String(14 - i).padStart(2, "0")}`, energy_score: 4, sleep_hours: 7.5, training_logged: i % 2 === 0 });
    }
    for (let i = 0; i < 7; i++) {
      points.push({ checkin_date: `2026-05-${String(7 - i).padStart(2, "0")}`, energy_score: 3, sleep_hours: 7 });
    }
    const t = summarizeCheckins(points);
    expect(t.count).toBe(14);
    expect(t.avgEnergy).toBe(4);
    expect(t.energyDelta).toBe(1); // 4 - 3
    expect(t.sleepDelta).toBe(0.5); // 7.5 - 7
    expect(t.trainingDays).toBe(4); // i=0,2,4,6
  });

  it("returns null deltas without a prior window", () => {
    const t = summarizeCheckins([
      { checkin_date: "2026-05-02", energy_score: 4, sleep_hours: 8 },
    ]);
    expect(t.avgEnergy).toBe(4);
    expect(t.energyDelta).toBeNull();
  });

  it("falls back to counting check-ins if a date is malformed", () => {
    // Real dates come from a Postgres `date` column and are always ISO, but a
    // throw here would take down the whole Trends response over one bad row.
    const t = summarizeCheckins([
      { checkin_date: "not-a-date", energy_score: 4, sleep_hours: 8 },
    ]);
    expect(t.avgEnergy).toBe(4);
  });

  it("A MISSED DAY IS NOT A ZERO", () => {
    // The thing a user actually worries about: skipping a day and having it
    // averaged in as "you slept 0 hours". Six 8-hour nights in a 7-day window
    // average 8, not 6.86.
    const points: CheckinPoint[] = [
      { checkin_date: "2026-05-14", energy_score: 4, sleep_hours: 8 },
      { checkin_date: "2026-05-13", energy_score: 4, sleep_hours: 8 },
      // 12th skipped entirely.
      { checkin_date: "2026-05-11", energy_score: 4, sleep_hours: 8 },
      { checkin_date: "2026-05-10", energy_score: 4, sleep_hours: 8 },
      { checkin_date: "2026-05-09", energy_score: 4, sleep_hours: 8 },
      { checkin_date: "2026-05-08", energy_score: 4, sleep_hours: 8 },
    ];
    expect(summarizeCheckins(points).avgSleep).toBe(8);
  });

  it("does not average in a check-in that logged no sleep figure", () => {
    // Logging energy but leaving sleep blank is not sleeping zero hours.
    const t = summarizeCheckins([
      { checkin_date: "2026-05-14", energy_score: 4, sleep_hours: 8 },
      { checkin_date: "2026-05-13", energy_score: 2, sleep_hours: null },
    ]);
    expect(t.avgSleep).toBe(8);
    expect(t.avgEnergy).toBe(3);
  });

  it("measures seven calendar days, not the last seven check-ins", () => {
    // With gaps these differ, and the old behaviour made "7d" describe a
    // stretch of arbitrary length. Eight check-ins spread over 30 days: only
    // those inside the 7 days ending at the newest one count.
    const points: CheckinPoint[] = [
      { checkin_date: "2026-05-14", energy_score: 5, sleep_hours: 8 },
      { checkin_date: "2026-05-10", energy_score: 5, sleep_hours: 8 },
      { checkin_date: "2026-04-28", energy_score: 1, sleep_hours: 4 },
      { checkin_date: "2026-04-20", energy_score: 1, sleep_hours: 4 },
    ];
    const t = summarizeCheckins(points);
    // Only the 14th and 10th are within 7 days of the 14th.
    expect(t.avgEnergy).toBe(5);
    // `count` stays the honest total logged, which is what the card says.
    expect(t.count).toBe(4);
  });

  it("compares two windows of equal length, so the delta means something", () => {
    // Days 8 to 14 against days 1 to 7, regardless of how many check-ins fall
    // in each. Previously a quiet fortnight was measured against a busy week.
    const points: CheckinPoint[] = [
      { checkin_date: "2026-05-14", energy_score: 4, sleep_hours: 8 },
      { checkin_date: "2026-05-13", energy_score: 4, sleep_hours: 8 },
      { checkin_date: "2026-05-05", energy_score: 2, sleep_hours: 6 },
    ];
    const t = summarizeCheckins(points);
    expect(t.avgEnergy).toBe(4);
    expect(t.energyDelta).toBe(2); // 4 - 2
    expect(t.sleepDelta).toBe(2); // 8 - 6
  });

  it("counts training days inside the window only", () => {
    const points: CheckinPoint[] = [
      { checkin_date: "2026-05-14", energy_score: 4, sleep_hours: 8, training_logged: true },
      { checkin_date: "2026-05-13", energy_score: 4, sleep_hours: 8, training_logged: true },
      { checkin_date: "2026-04-01", energy_score: 4, sleep_hours: 8, training_logged: true },
    ];
    // The April one is outside the week, and the card labels this "this week".
    expect(summarizeCheckins(points).trainingDays).toBe(2);
  });

  it("stays populated for someone returning after a long break", () => {
    // The window counts back from the newest check-in, not from today, so a
    // gap does not empty the card and leave a returning user with nothing.
    const t = summarizeCheckins([
      { checkin_date: "2020-01-02", energy_score: 4, sleep_hours: 8 },
      { checkin_date: "2020-01-01", energy_score: 4, sleep_hours: 8 },
    ]);
    expect(t.avgSleep).toBe(8);
  });
});
