import { describe, expect, it } from "vitest";

import {
  addDays,
  computeActive,
  computeFunnel,
  computeRetention,
  computeStreakBuckets,
  computeDeviceAdoption,
  dailySeries,
  type DeviceRow,
  MIN_SEGMENT_COHORT,
  retentionBySegment,
  activityBySegment,
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

/* -------------------------------------------------------------------------- */
/* Devices                                                                    */
/* -------------------------------------------------------------------------- */

const dev = (
  user_id: string,
  provider: string,
  over: Partial<DeviceRow> = {},
): DeviceRow => ({ user_id, provider, status: "active", last_sync_at: "2026-08-07T00:00:00Z", ...over });

describe("computeDeviceAdoption", () => {
  it("separates connected from actually syncing", () => {
    // The gap between these two is where every wearable incident in this
    // project has lived: a row saying active with nothing behind it.
    const out = computeDeviceAdoption([
      dev("u1", "oura"),
      dev("u2", "oura", { last_sync_at: null }),
    ]);
    expect(out.usersWithAnyDevice).toBe(2);
    expect(out.usersSyncing).toBe(1);
    expect(out.byProvider[0]).toMatchObject({ provider: "oura", connected: 2, syncing: 1 });
  });

  it("counts a user once per provider however many rows exist", () => {
    const out = computeDeviceAdoption([dev("u1", "oura"), dev("u1", "oura")]);
    expect(out.byProvider[0].connected).toBe(1);
  });

  it("counts a user with two providers once overall", () => {
    const out = computeDeviceAdoption([dev("u1", "oura"), dev("u1", "whoop")]);
    expect(out.usersWithAnyDevice).toBe(1);
    expect(out.byProvider).toHaveLength(2);
  });

  it("surfaces connections that need reconnecting", () => {
    const out = computeDeviceAdoption([dev("u1", "oura", { status: "expired" })]);
    expect(out.byProvider[0].needsReauth).toBe(1);
  });

  it("survives a malformed row rather than throwing", () => {
    const out = computeDeviceAdoption([
      null as unknown as DeviceRow,
      { user_id: "", provider: "", status: "active", last_sync_at: null },
      dev("u1", "oura"),
    ]);
    expect(out.usersWithAnyDevice).toBe(1);
  });
});

describe("segmented reporting refuses to invent a retention story", () => {
  const today = "2026-08-31";
  /** `n` users who all signed up on the same day, ids prefixed. */
  const cohort = (prefix: string, n: number): UserRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i}`,
      created_at: "2026-08-01T00:00:00Z",
    }));

  it("withholds the rate below the minimum cohort, but still shows counts", () => {
    // A percentage off two people is not a weak signal, it is a wrong answer
    // with a decimal point, and it sits next to a bar chart looking like data.
    const users = cohort("d", 2);
    const active = new Map(users.map((u) => [u.id, new Set(["2026-08-02"])]));
    const out = retentionBySegment(users, active, new Set(users.map((u) => u.id)), today);
    const device = out.find((s) => s.segment === "device")!;
    const d1 = device.points.find((p) => p.day === 1)!;
    expect(d1.rate).toBeNull();
    expect(d1.retained).toBe(2);
    expect(d1.eligible).toBe(2);
  });

  it("reports a rate once the cohort is large enough", () => {
    const users = cohort("d", MIN_SEGMENT_COHORT);
    const active = new Map(users.map((u) => [u.id, new Set(["2026-08-02"])]));
    const out = retentionBySegment(users, active, new Set(users.map((u) => u.id)), today);
    expect(out.find((s) => s.segment === "device")!.points[0].rate).toBe(1);
  });

  it("leaves the whole-population figure untouched", () => {
    // The default minCohort is 1, so the existing panel keeps showing "2 of 3"
    // exactly as it did. This change must not move that number.
    const users = cohort("u", 2);
    const active = new Map([[users[0].id, new Set(["2026-08-02"])]]);
    expect(computeRetention(users, active, today)[0].rate).toBe(0.5);
  });

  it("segments on ever-connected, so a disconnect does not move somebody", () => {
    // Dropping them would select for the happy path: the people most likely to
    // leave are exactly the ones who would fall out of the segment.
    const users = cohort("u", 4);
    const active = new Map<string, Set<string>>();
    const out = retentionBySegment(users, active, new Set(["u0", "u1"]), today);
    expect(out.find((s) => s.segment === "device")!.users).toBe(2);
    expect(out.find((s) => s.segment === "no_device")!.users).toBe(2);
  });
});

describe("activityBySegment", () => {
  const today = "2026-08-31";
  const users: UserRow[] = [
    { id: "a", created_at: "2026-08-01T00:00:00Z" },
    { id: "b", created_at: "2026-08-01T00:00:00Z" },
  ];

  it("counts every day in the window, not one specific day", () => {
    // The reason this sits beside day-N retention: somebody who used the app on
    // days 6 and 8 counts as lost at D7 and is plainly not lost.
    const active = new Map([["a", new Set(["2026-08-20", "2026-08-25", "2026-08-30"])]]);
    const out = activityBySegment(users, active, new Set(["a"]), today);
    expect(out.find((s) => s.segment === "device")).toMatchObject({
      users: 1,
      active: 1,
      meanActiveDays: 3,
    });
  });

  it("ignores days outside the window and in the future", () => {
    const active = new Map([["a", new Set(["2026-01-01", "2027-01-01", "2026-08-30"])]]);
    const out = activityBySegment(users, active, new Set(["a"]), today);
    expect(out.find((s) => s.segment === "device")!.meanActiveDays).toBe(1);
  });

  it("returns null rather than zero for an empty segment", () => {
    // Zero would read as "these people never open the app". Nobody is in the
    // segment, which is a different statement.
    const out = activityBySegment(users, new Map(), new Set(), today);
    expect(out.find((s) => s.segment === "device")!.meanActiveDays).toBeNull();
    expect(out.find((s) => s.segment === "no_device")!.meanActiveDays).toBe(0);
  });
});
