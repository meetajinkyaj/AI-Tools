import { describe, expect, it } from "vitest";

import {
  categoryForType,
  EXERCISE_TYPES,
  EXERCISE_TYPE_LABELS,
  matchExerciseType,
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

describe("matchExerciseType", () => {
  it("maps what the four vendors actually call weight training", () => {
    // Oura, Whoop, Fitbit and Ultrahuman each have their own word for it, and
    // the check-in has a fifth. They are one activity.
    for (const raw of [
      "weight_training",
      "Weightlifting",
      "Weights",
      "Strength Training",
      "strength-training",
      "resistance training",
    ]) {
      expect(matchExerciseType(raw), raw).toBe("gym");
    }
  });

  it("does not let 'gymnastics' fall into 'gym'", () => {
    // The ordering trap: "gym" is a substring of "gymnastics", so anything
    // matching on substrings has to test the longer word first.
    expect(matchExerciseType("Gymnastics")).toBe("gymnastics");
    expect(matchExerciseType("calisthenics")).toBe("gymnastics");
  });

  it("flattens the separators vendors disagree about", () => {
    for (const raw of ["yoga", "Hot Yoga", "yoga_flow", "yoga-nidra"]) {
      expect(matchExerciseType(raw), raw).toBe("yoga_mobility");
    }
  });

  it("places the common cardio and sport names", () => {
    expect(matchExerciseType("Treadmill Running")).toBe("running");
    expect(matchExerciseType("Indoor Cycling")).toBe("cycling");
    expect(matchExerciseType("Open Water Swim")).toBe("swimming");
    expect(matchExerciseType("Hiking/Rucking")).toBe("hiking");
    expect(matchExerciseType("Padel")).toBe("sports");
    expect(matchExerciseType("Kickboxing")).toBe("boxing");
    expect(matchExerciseType("Functional Fitness")).toBe("functional");
    expect(matchExerciseType("HIIT")).toBe("functional");
  });

  it("returns null rather than guessing at something it does not know", () => {
    // A wrong category prints a word that misdescribes what the person did,
    // which is worse than printing the vendor's own.
    for (const raw of ["Rowing", "Elliptical", "Kabaddi", "", "   ", null, undefined]) {
      expect(matchExerciseType(raw), String(raw)).toBeNull();
    }
  });
});
