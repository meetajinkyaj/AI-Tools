import { describe, expect, it } from "vitest";

import {
  filledDots,
  ikiScore100,
  last30Statuses,
  nextUnlock,
  pillarFractions,
  shiftDate,
  weekInputs,
} from "./home-summary";

const day = (checkin_date: string, sleep_hours: number | null, training_logged = false) => ({
  checkin_date,
  sleep_hours,
  training_logged,
});

describe("last30Statuses", () => {
  it("returns thirty days ending today, oldest first", () => {
    const out = last30Statuses([day("2026-09-30", 7), day("2026-09-01", 8)], "2026-09-30");
    expect(out).toHaveLength(30);
    expect(out[29]).toBe("g");
    expect(out[0]).toBe("g"); // 2026-09-01 is 29 days back
    expect(out.slice(1, 29).every((s) => s === "n")).toBe(true);
  });

  it("marks a check-in without sleep as partial", () => {
    expect(last30Statuses([day("2026-09-30", null)], "2026-09-30")[29]).toBe("p");
  });

  it("crosses month boundaries in UTC", () => {
    expect(shiftDate("2026-10-01", -1)).toBe("2026-09-30");
  });
});

describe("weekInputs", () => {
  const rows = [
    day("2026-09-30", 7, true),
    day("2026-09-29", 8),
    day("2026-09-24", 6, true), // exactly 6 days back: inside
    day("2026-09-23", 5, true), // 7 days back: outside
  ];

  it("counts training days and averages sleep over the 7 days ending on the date", () => {
    expect(weekInputs(rows, "2026-09-30")).toEqual({ trainingDays: 2, avgSleep: 7 });
  });

  it("gives yesterday's window for the delta", () => {
    expect(weekInputs(rows, "2026-09-29")).toEqual({ trainingDays: 2, avgSleep: 6.3 });
  });

  it("counts a day with logged exercises as trained", () => {
    const r = [{ checkin_date: "2026-09-30", sleep_hours: 7, exercises: [{ type: "gym" }] }];
    expect(weekInputs(r, "2026-09-30").trainingDays).toBe(1);
  });

  it("has no sleep figure when none was logged", () => {
    expect(weekInputs([day("2026-09-30", null)], "2026-09-30").avgSleep).toBeNull();
  });
});

describe("iki score (0-100)", () => {
  it("averages the three pillars", () => {
    const f = pillarFractions({ trainingDays: 7, avgSleep: 9 }, { inRange: 17, total: 34, worthALook: 3 });
    expect(f).toEqual({ performance: 1, recovery: 1, longevity: 0.5 });
    expect(ikiScore100(f)).toBe(83);
  });

  it("leaves out a pillar with no data instead of scoring it zero", () => {
    const f = pillarFractions({ trainingDays: 0, avgSleep: 9 }, null);
    expect(f.longevity).toBeNull();
    expect(ikiScore100(f)).toBe(50);
  });

  it("caps sleep at the target", () => {
    expect(pillarFractions({ trainingDays: 0, avgSleep: 11 }, null).recovery).toBe(1);
  });

  it("scores a brand-new member zero on training alone, never NaN", () => {
    const f = pillarFractions({ trainingDays: Number.NaN, avgSleep: null }, null);
    expect(ikiScore100(f)).toBe(0);
  });
});

describe("nextUnlock", () => {
  const v = (name: string, cost: number, codes: number | null = 5) => ({
    name,
    partner: "P",
    kind: "voucher",
    points_cost: cost,
    available_codes: codes,
  });

  it("points at the cheapest voucher still out of reach", () => {
    expect(nextUnlock([v("A", 200), v("B", 350), v("C", 500)], 265)).toEqual({
      state: "locked",
      name: "B",
      partner: "P",
      cost: 350,
      remaining: 85,
    });
  });

  it("ignores sold-out vouchers and non-vouchers", () => {
    const items = [v("Sold out", 300, 0), { ...v("Product", 300), kind: "product" }];
    expect(nextUnlock(items, 100)).toEqual({ state: "none" });
  });

  it("says so when everything is affordable", () => {
    expect(nextUnlock([v("A", 200)], 710)).toEqual({ state: "all-affordable" });
  });

  it("fills the dot grid in proportion, never past the end", () => {
    expect(filledDots(265, 350)).toBe(12);
    expect(filledDots(900, 350)).toBe(16);
    expect(filledDots(0, 350)).toBe(0);
  });
});
