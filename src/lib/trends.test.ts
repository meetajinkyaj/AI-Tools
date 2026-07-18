import { describe, expect, it } from "vitest";

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
    { marker_key: "ldl_c", marker_name: "LDL", value: 150, flag: "high", direction: "lower_better" }, // better, still high — now rewarded
    { marker_key: "hdl_c", marker_name: "HDL", value: 66.5, flag: "in_range", direction: "higher_better" }, // <1% move — noise
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
    expect(awards.every((a) => a.points === 250)).toBe(true);
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
      points.push({ checkin_date: `2026-05-${14 - i}`, energy_score: 4, sleep_hours: 7.5, training_logged: i % 2 === 0 });
    }
    for (let i = 0; i < 7; i++) {
      points.push({ checkin_date: `2026-05-0${7 - i}`, energy_score: 3, sleep_hours: 7 });
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
});
