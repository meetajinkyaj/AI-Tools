import { describe, expect, it } from "vitest";

import {
  computeAwards,
  STREAK_MILESTONES,
  computeStreak,
  daysBetweenUTC,
  displayStreak,
  totalAwarded,
  validateCheckinInput,
} from "./checkin";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    sleep_hours: 7.5,
    energy_score: 4,
    training_logged: true,
    nutrition_note: "  ate clean  ",
    ...overrides,
  };
}

describe("validateCheckinInput", () => {
  it("accepts and normalizes a valid body", () => {
    const r = validateCheckinInput(validBody());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.energy_score).toBe(4);
      expect(r.value.sleep_hours).toBe(7.5);
      expect(r.value.training_logged).toBe(true);
      expect(r.value.nutrition_note).toBe("ate clean"); // trimmed
    }
  });

  it("requires a valid energy score", () => {
    expect(validateCheckinInput(validBody({ energy_score: 0 })).ok).toBe(false);
    expect(validateCheckinInput(validBody({ energy_score: 6 })).ok).toBe(false);
    expect(validateCheckinInput(validBody({ energy_score: 3.5 })).ok).toBe(false);
    expect(validateCheckinInput(validBody({ energy_score: "4" })).ok).toBe(false);
  });

  it("treats sleep and note as optional, defaulting to null", () => {
    const r = validateCheckinInput({ energy_score: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sleep_hours).toBeNull();
      expect(r.value.nutrition_note).toBeNull();
      expect(r.value.training_logged).toBe(false);
    }
  });

  it("accepts a numeric sleep value from a string", () => {
    const r = validateCheckinInput(validBody({ sleep_hours: "6" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sleep_hours).toBe(6);
  });

  it("rejects out-of-range sleep and over-long notes", () => {
    expect(validateCheckinInput(validBody({ sleep_hours: 25 })).ok).toBe(false);
    expect(validateCheckinInput(validBody({ sleep_hours: -1 })).ok).toBe(false);
    expect(validateCheckinInput(validBody({ nutrition_note: "x".repeat(501) })).ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(validateCheckinInput(null).ok).toBe(false);
    expect(validateCheckinInput("nope").ok).toBe(false);
  });

  it("defaults exercises to [] and normalizes per-activity entries", () => {
    const base = validateCheckinInput(validBody());
    expect(base.ok).toBe(true);
    if (base.ok) expect(base.value.exercises).toEqual([]);

    const r = validateCheckinInput(
      validBody({
        exercises: [
          { type: "running", duration: "medium" },
          { type: "other", label: "  padel  ", duration: "short" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.exercises).toEqual([
        { type: "running", label: null, duration: "medium" },
        { type: "other", label: "padel", duration: "short" },
      ]);
    }
  });

  it("rejects exercises with an unknown type", () => {
    expect(
      validateCheckinInput(validBody({ exercises: [{ type: "quidditch" }] })).ok,
    ).toBe(false);
  });
});

describe("daysBetweenUTC", () => {
  it("counts whole days across month boundaries", () => {
    expect(daysBetweenUTC("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetweenUTC("2026-02-28", "2026-03-01")).toBe(1); // 2026 not a leap year
    expect(daysBetweenUTC("2026-07-01", "2026-07-01")).toBe(0);
  });
});

describe("computeStreak", () => {
  it("starts at 1 with no prior check-in", () => {
    expect(computeStreak(null, 0, "2026-07-14")).toBe(1);
  });
  it("continues when the prior check-in was yesterday", () => {
    expect(computeStreak("2026-07-13", 6, "2026-07-14")).toBe(7);
  });
  it("restarts when there is a gap", () => {
    expect(computeStreak("2026-07-11", 9, "2026-07-14")).toBe(1);
  });
});

describe("computeAwards / totalAwarded", () => {
  it("awards the base points on an ordinary day", () => {
    const a = computeAwards(3);
    expect(a).toEqual([{ reason: "checkin", amount: 10 }]);
    expect(totalAwarded(a)).toBe(10);
  });
  it("pays a milestone the first time it is reached", () => {
    // bestStreak 0 = never got there before.
    expect(totalAwarded(computeAwards(7, 0))).toBe(60);
    expect(totalAwarded(computeAwards(30, 29))).toBe(260);
    expect(totalAwarded(computeAwards(90, 89))).toBe(510);
    expect(totalAwarded(computeAwards(180, 179))).toBe(1010);
    expect(totalAwarded(computeAwards(365, 364))).toBe(2510);
  });

  it("never pays the same milestone twice", () => {
    // Day 8 of a streak whose best is already 7: just the daily 10.
    expect(totalAwarded(computeAwards(8, 7))).toBe(10);
    // A 200-day streak that has already banked 7/30/90/180.
    expect(totalAwarded(computeAwards(200, 199))).toBe(10);
  });

  it("closes the streak-farming hole", () => {
    // The old rule fired whenever the streak EQUALLED 7, so cycling
    // 7-on/1-off collected 50 every eight days forever and beat a perfect
    // streak by 38% over a year. Rebuilding to 7 when the best is already 7
    // must now pay nothing beyond the daily.
    expect(totalAwarded(computeAwards(7, 7))).toBe(10);
    expect(totalAwarded(computeAwards(7, 30))).toBe(10);

    // Over a year: a perfect streak must out-earn any cycle.
    const perfect = Array.from({ length: 365 }, (_, i) =>
      totalAwarded(computeAwards(i + 1, i)),
    ).reduce((a, b) => a + b, 0);
    let cycled = 0;
    let streak = 0;
    let best = 0;
    for (let d = 0; d < 365; d++) {
      if (streak === 7) { streak = 0; continue; } // deliberate miss
      streak++;
      cycled += totalAwarded(computeAwards(streak, best));
      best = Math.max(best, streak);
    }
    expect(perfect).toBeGreaterThan(cycled);
  });

  it("catches up if several milestones are crossed at once", () => {
    // Cannot happen a day at a time, but can if a streak is ever backfilled.
    expect(totalAwarded(computeAwards(100, 0))).toBe(10 + 50 + 250 + 500);
  });

  it("rewards going long, which the old ladder stopped doing at 30", () => {
    const beyond = STREAK_MILESTONES.filter((m) => m.days > 30);
    expect(beyond.map((m) => m.days)).toEqual([90, 180, 365]);
  });
});

describe("displayStreak", () => {
  it("is 0 with no check-ins", () => {
    expect(displayStreak(null, 0, "2026-07-14")).toBe(0);
  });
  it("stays alive when the last check-in was today or yesterday", () => {
    expect(displayStreak("2026-07-14", 5, "2026-07-14")).toBe(5);
    expect(displayStreak("2026-07-13", 5, "2026-07-14")).toBe(5);
  });
  it("resets to 0 once a day is missed", () => {
    expect(displayStreak("2026-07-12", 5, "2026-07-14")).toBe(0);
  });
});
