import { describe, expect, it } from "vitest";

import { barOpacity, signed, weekBars } from "./week-bars";

describe("weekBars", () => {
  const series = [
    { checkin_date: "2026-09-30", energy_score: 4 },
    { checkin_date: "2026-09-28", energy_score: 3 },
    { checkin_date: "2026-09-20", energy_score: 5 }, // outside the week
  ];

  it("is the calendar week ending today, with missed days empty", () => {
    const bars = weekBars(series, (p) => p.energy_score, "2026-09-30");
    expect(bars.map((b) => b.date)).toEqual([
      "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30",
    ]);
    expect(bars.map((b) => b.value)).toEqual([null, null, null, null, 3, null, 4]);
    expect(bars[6].isToday).toBe(true);
  });

  it("labels days by weekday (30 Sep 2026 is a Wednesday)", () => {
    expect(weekBars([], () => null, "2026-09-30").map((b) => b.letter).join("")).toBe("TFSSMTW");
  });
});

describe("bar opacity", () => {
  it("fades from 0.55 to 0.95, with today at full strength", () => {
    expect(barOpacity(0, false)).toBe(0.55);
    expect(barOpacity(6, false)).toBe(0.95);
    expect(barOpacity(6, true)).toBe(1);
  });
});

describe("signed", () => {
  it("uses a real minus sign and rounds to one place", () => {
    expect(signed(0.44)).toBe("+0.4");
    expect(signed(-0.67, "h")).toBe("−0.7h");
    expect(signed(0)).toBe("0");
  });
});
