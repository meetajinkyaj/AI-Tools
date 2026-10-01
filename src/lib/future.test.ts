import { describe, expect, it } from "vitest";

import {
  computeHabitSignals,
  computeMomentum,
  markerOutlook,
  projectLinear,
  retestMilestone,
} from "./future";
import { checkinDaysInWindow, momentumOutlook } from "./future";
import type { CheckinPoint } from "./trends";

/** N consecutive daily check-ins ending 2026-01-30, newest first. */
function checkins(
  n: number,
  overrides: Partial<CheckinPoint> = {},
): CheckinPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 30) - i * 86_400_000);
    return {
      checkin_date: d.toISOString().slice(0, 10),
      energy_score: 4,
      sleep_hours: 7.5,
      training_logged: true,
      ...overrides,
    };
  });
}

describe("computeHabitSignals / computeMomentum", () => {
  it("scores a consistent, well-slept, training user as strong", () => {
    const m = computeMomentum(computeHabitSignals(checkins(30)));
    expect(m.level).toBe("strong");
    expect(m.score).toBeGreaterThanOrEqual(70);
  });

  it("scores no data as early", () => {
    const m = computeMomentum(computeHabitSignals([]));
    expect(m.level).toBe("early");
    expect(m.score).toBe(0);
  });

  it("gives partial credit for moderate habits", () => {
    const m = computeMomentum(
      computeHabitSignals(checkins(10, { sleep_hours: 6.5, training_logged: false })),
    );
    expect(m.level).toBe("early");
    expect(m.score).toBeGreaterThan(0);
    expect(m.score).toBeLessThan(70);
  });
});

describe("projectLinear", () => {
  it("returns null with fewer than 2 points", () => {
    expect(projectLinear([{ date: "2026-01-01", value: 5 }])).toBeNull();
    expect(projectLinear([])).toBeNull();
  });

  it("projects the trend forward from two points", () => {
    // 6.0 → 5.6 over ~6 months; six more months continues down, clamped ≤ 30%.
    const p = projectLinear([
      { date: "2025-07-01", value: 6.0 },
      { date: "2026-01-01", value: 5.6 },
    ]);
    expect(p).not.toBeNull();
    expect(p!.projected).toBeLessThan(5.6);
    expect(p!.projected).toBeGreaterThanOrEqual(5.6 * 0.7);
    expect(p!.projectionDate > "2026-01-01").toBe(true);
  });

  it("clamps a runaway slope to 30% of the latest value", () => {
    // Steep drop over a short gap would project far below zero un-clamped.
    const p = projectLinear([
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-15", value: 60 },
    ]);
    expect(p!.projected).toBe(60 - 60 * 0.3); // clamped floor
  });

  it("returns null when all observations share one date", () => {
    expect(
      projectLinear([
        { date: "2026-01-01", value: 5 },
        { date: "2026-01-01", value: 6 },
      ]),
    ).toBeNull();
  });
});

describe("markerOutlook", () => {
  const flagged = {
    marker_key: "hba1c",
    marker_name: "HbA1c",
    value: 5.9,
    flag: "high",
    direction: "lower_better",
    ref_low: null,
    ref_high: 5.7,
  };

  it("uses linear_v1 with real history and reads healthy direction as improving", () => {
    const o = markerOutlook(
      flagged,
      [
        { date: "2025-07-01", value: 6.3 },
        { date: "2026-01-01", value: 5.9 },
      ],
      computeMomentum(computeHabitSignals([])),
    );
    expect(o.model).toBe("linear_v1");
    expect(o.outlook).toBe("improving");
    expect(o.projected_value).not.toBeNull();
  });

  it("falls back to habit_v1 on a single panel, no invented number", () => {
    const o = markerOutlook(flagged, [{ date: "2026-01-01", value: 5.9 }],
      computeMomentum(computeHabitSignals(checkins(30))));
    expect(o.model).toBe("habit_v1");
    expect(o.projected_value).toBeNull();
    expect(o.outlook).toBe("improving"); // strong momentum
  });

  it("marks needs_inputs when there is no habit signal either", () => {
    const o = markerOutlook(flagged, [], computeMomentum(computeHabitSignals([])));
    expect(o.model).toBe("habit_v1");
    expect(o.outlook).toBe("needs_inputs");
  });
});

describe("retestMilestone", () => {
  it("puts the due date ~6 months after the last panel", () => {
    const m = retestMilestone("2026-01-01", "2026-02-01");
    expect(m.dueDate).toBe("2026-07-02"); // 182 days on
    expect(m.daysUntilDue).toBe(151);
  });

  it("goes negative when overdue", () => {
    const m = retestMilestone("2025-01-01", "2026-02-01");
    expect(m.daysUntilDue).toBeLessThan(0);
  });
});

describe("momentumOutlook (v2 Future card)", () => {
  const day = (d: string, trained = false) => ({
    checkin_date: d,
    energy_score: 3,
    sleep_hours: 7.5,
    training_logged: trained,
  });

  it("projects a higher momentum when today's check-in with training is still to come", () => {
    const rows = ["2026-09-27", "2026-09-28", "2026-09-29"].map((d) => day(d));
    const o = momentumOutlook(rows, "2026-09-30");
    expect(o.checkedInToday).toBe(false);
    const now = computeMomentum(computeHabitSignals(rows)).score;
    expect(o.projectedIfCheckedIn).not.toBeNull();
    expect(o.projectedIfCheckedIn!).toBeGreaterThan(now);
  });

  it("has nothing to project once today is in", () => {
    const o = momentumOutlook([day("2026-09-30")], "2026-09-30");
    expect(o.checkedInToday).toBe(true);
    expect(o.projectedIfCheckedIn).toBeNull();
  });

  it("reports no monthly change without history older than the window", () => {
    expect(momentumOutlook([day("2026-09-30")], "2026-09-30").changeThisMonth).toBeNull();
  });

  it("compares with the window a month ago when there is one", () => {
    const old = ["2026-08-20", "2026-08-25"].map((d) => day(d));
    const recent = Array.from({ length: 20 }, (_, i) => day(`2026-09-${String(i + 10).padStart(2, "0")}`, i % 2 === 0));
    const o = momentumOutlook([...old, ...recent], "2026-09-30");
    expect(o.changeThisMonth).not.toBeNull();
    expect(o.changeThisMonth!).toBeGreaterThan(0);
    expect(o.checkinsThisMonth).toBe(20);
  });
});

describe("check-in consistency counts only the 30-day window", () => {
  const point = (checkin_date: string) => ({ checkin_date, energy_score: 3, sleep_hours: 7 });
  const daysBack = (n: number) =>
    new Date(Date.parse("2026-09-30T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);

  it("does not count the previous window's check-ins (the bug)", () => {
    // 20 check-ins in each of the last two 30-day windows: 40 rows, as the
    // API passes them. The old rule read this as 40/30, capped to 100%.
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => point(daysBack(i))),
      ...Array.from({ length: 20 }, (_, i) => point(daysBack(30 + i))),
    ];
    expect(computeHabitSignals(rows, 30, null, "2026-09-30").checkinRate).toBeCloseTo(20 / 30);
  });

  it("anchors on today, so a member who stopped is not credited for old days", () => {
    const rows = Array.from({ length: 30 }, (_, i) => point(daysBack(20 + i)));
    expect(checkinDaysInWindow(rows, 30, "2026-09-30")).toBe(10);
  });

  it("counts a day once even if it has two rows", () => {
    expect(checkinDaysInWindow([point("2026-09-30"), point("2026-09-30")], 30, "2026-09-30")).toBe(1);
  });

  it("falls back to the newest check-in when no date is given", () => {
    expect(checkinDaysInWindow([point("2026-08-01"), point("2026-08-15")], 30)).toBe(2);
  });

  it("keeps the dots and the % in step", () => {
    const rows = Array.from({ length: 26 }, (_, i) => point(daysBack(i)));
    const o = momentumOutlook(rows, "2026-09-30");
    const rate = computeHabitSignals(rows, 30, null, "2026-09-30").checkinRate;
    expect(o.checkinsThisMonth).toBe(Math.round(rate * 30));
  });
});
