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
    { marker_key: "hba1c", marker_name: "HbA1c", value: 5.9, flag: "high" },
    { marker_key: "ldl_c", marker_name: "LDL", value: 165, flag: "high" },
    { marker_key: "hdl_c", marker_name: "HDL", value: 66, flag: "in_range" },
  ],
};
const latest: PanelSnapshot = {
  date: "2026-05-01", // 120 days later
  readings: [
    { marker_key: "hba1c", marker_name: "HbA1c", value: 5.4, flag: "in_range" }, // improved
    { marker_key: "ldl_c", marker_name: "LDL", value: 150, flag: "high" }, // better but still high
    { marker_key: "hdl_c", marker_name: "HDL", value: 70, flag: "in_range" }, // was fine
  ],
};

describe("daysBetween", () => {
  it("counts whole days regardless of order", () => {
    expect(daysBetween("2026-01-01", "2026-05-01")).toBe(120);
    expect(daysBetween("2026-05-01", "2026-01-01")).toBe(120);
  });
});

describe("computeOutcomeAwards", () => {
  it("rewards only markers that moved out-of-range → in-range", () => {
    const awards = computeOutcomeAwards(prev, latest);
    expect(awards.map((a) => a.marker_key)).toEqual(["hba1c"]);
    expect(awards[0].delta).toBe(-0.5);
    expect(awards[0].points).toBe(250);
  });

  it("blocks awards when panels are too close together (anti-gaming)", () => {
    const soon: PanelSnapshot = { ...latest, date: "2026-01-20" }; // 19 days
    expect(computeOutcomeAwards(prev, soon)).toEqual([]);
  });

  it("caps the number of rewarded markers", () => {
    const manyPrev: PanelSnapshot = {
      date: "2026-01-01",
      readings: ["a", "b", "c", "d"].map((k) => ({
        marker_key: k,
        value: 10,
        flag: "high",
      })),
    };
    const manyLatest: PanelSnapshot = {
      date: "2026-06-01",
      readings: ["a", "b", "c", "d"].map((k) => ({
        marker_key: k,
        value: 1,
        flag: "in_range",
      })),
    };
    expect(computeOutcomeAwards(manyPrev, manyLatest)).toHaveLength(3);
  });
});

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
