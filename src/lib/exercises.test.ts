import { describe, expect, it } from "vitest";

import {
  categoryForType,
  EXERCISE_TYPES,
  EXERCISE_TYPE_LABELS,
  normalizeActivities,
  validateExercises,
} from "./exercises";

describe("taxonomy", () => {
  it("has a label and category for every type", () => {
    for (const t of EXERCISE_TYPES) {
      expect(EXERCISE_TYPE_LABELS[t]).toBeTruthy();
      expect(categoryForType(t)).toBeTruthy();
    }
  });
  it("maps unknown/other types to the 'other' category", () => {
    expect(categoryForType("other")).toBe("other");
    expect(categoryForType("nonsense")).toBe("other");
  });
});

describe("normalizeActivities", () => {
  it("keeps only valid types, dedupes, and preserves order", () => {
    expect(normalizeActivities(["running", "gym", "running", "nope"])).toEqual([
      "running",
      "gym",
    ]);
  });
  it("returns [] for non-arrays", () => {
    expect(normalizeActivities("running")).toEqual([]);
    expect(normalizeActivities(undefined)).toEqual([]);
  });
});

describe("validateExercises", () => {
  it("accepts an empty/absent list", () => {
    expect(validateExercises(undefined)).toEqual({ ok: true, value: [] });
    expect(validateExercises([])).toEqual({ ok: true, value: [] });
  });

  it("accepts known types with durations and trims other labels", () => {
    const r = validateExercises([
      { type: "running", duration: "medium" },
      { type: "other", label: "  padel  ", duration: "short" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]).toEqual({ type: "running", label: null, duration: "medium" });
      expect(r.value[1]).toEqual({ type: "other", label: "padel", duration: "short" });
    }
  });

  it("nulls out an invalid duration rather than failing", () => {
    const r = validateExercises([{ type: "gym", duration: "forever" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0].duration).toBeNull();
  });

  it("rejects unknown types and non-array input", () => {
    expect(validateExercises([{ type: "quidditch" }]).ok).toBe(false);
    expect(validateExercises("nope").ok).toBe(false);
  });

  it("rejects an over-long other label", () => {
    expect(
      validateExercises([{ type: "other", label: "x".repeat(61) }]).ok,
    ).toBe(false);
  });
});
