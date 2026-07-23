import { describe, expect, it } from "vitest";

import {
  addDays,
  computeActive,
  computeFunnel,
  computeRetention,
  computeStreakBuckets,
  dailySeries,
  type UserRow,
} from "./analytics";

const user = (id: string, created: string): UserRow => ({
  id,
  created_at: `${created}T10:00:00Z`,
});

describe("computeFunnel", () => {
  it("counts onboarded, activated and retested users", () => {
    const users = [user("a", "2026-01-01"), user("b", "2026-01-02"), user("c", "2026-01-03")];
    const funnel = computeFunnel(
      users,
      new Set(["a", "b"]),
      new Map([
        ["a", new Set(["2026-01-05", "2026-07-05"])], // retested
        ["b", new Set(["2026-01-06"])], // activated only
      ]),
    );
    expect(funnel).toEqual({ users: 3, onboarded: 2, activated: 2, retested: 1 });
  });
});

describe("computeRetention", () => {
  it("computes day-N retention against exact activity dates", () => {
    const users = [user("a", "2026-01-01"), user("b", "2026-01-01")];
    const active = new Map([
      ["a", new Set(["2026-01-02", "2026-01-08"])], // d1 yes, d7 yes
      ["b", new Set(["2026-01-03"])], // d1 no, d7 no
    ]);
    const [d1, d7] = computeRetention(users, active, "2026-02-15", [1, 7]);
    expect(d1).toEqual({ day: 1, eligible: 2, retained: 1, rate: 0.5 });
    expect(d7).toEqual({ day: 7, eligible: 2, retained: 1, rate: 0.5 });
  });

  it("excludes users too new to be eligible (rate null when nobody is)", () => {
    const users = [user("a", "2026-02-14")];
    const [d30] = computeRetention(users, new Map(), "2026-02-15", [30]);
    expect(d30.eligible).toBe(0);
    expect(d30.rate).toBeNull();
  });
});

describe("computeActive", () => {
  it("buckets DAU/WAU/MAU from activity dates", () => {
    const active = new Map([
      ["a", new Set(["2026-02-15"])], // today → all three
      ["b", new Set(["2026-02-10"])], // 5 days ago → WAU+MAU
      ["c", new Set(["2026-01-20"])], // 26 days ago → MAU only
      ["d", new Set(["2025-12-01"])], // ancient → none
    ]);
    expect(computeActive(active, "2026-02-15")).toEqual({ dau: 1, wau: 2, mau: 3 });
  });
});

describe("computeStreakBuckets", () => {
  it("only counts live streaks (last check-in today or yesterday)", () => {
    const latest = new Map([
      ["a", { date: "2026-02-15", streak: 45 }], // live, month
      ["b", { date: "2026-02-14", streak: 8 }], // live (yesterday), week
      ["c", { date: "2026-02-15", streak: 2 }], // live, short
      ["d", { date: "2026-02-01", streak: 30 }], // stale → none
    ]);
    expect(computeStreakBuckets(latest, "2026-02-15")).toEqual({
      none: 1,
      short: 1,
      week: 1,
      month: 1,
    });
  });
});

describe("dailySeries", () => {
  it("zero-fills the window, oldest first", () => {
    const s = dailySeries(["2026-02-15", "2026-02-15", "2026-02-13"], "2026-02-15", 3);
    expect(s).toEqual([
      { date: "2026-02-13", count: 1 },
      { date: "2026-02-14", count: 0 },
      { date: "2026-02-15", count: 2 },
    ]);
  });
});

describe("addDays", () => {
  it("crosses month boundaries in UTC", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
