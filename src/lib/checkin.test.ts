import { describe, expect, it } from "vitest";

import {
  computeAwards,
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
  it("adds the 7-day bonus exactly at streak 7", () => {
    expect(totalAwarded(computeAwards(7))).toBe(60);
    expect(totalAwarded(computeAwards(8))).toBe(10);
  });
  it("adds the 30-day bonus exactly at streak 30", () => {
    expect(totalAwarded(computeAwards(30))).toBe(260);
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
