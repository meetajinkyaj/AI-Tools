import { describe, expect, it } from "vitest";

import { validateInterventionInput } from "./interventions";

describe("validateInterventionInput", () => {
  it("accepts a valid entry and trims fields", () => {
    const r = validateInterventionInput({
      type: "supplement",
      label: "  Magnesium glycinate  ",
      dose_note: "  400mg nightly  ",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.label).toBe("Magnesium glycinate");
      expect(r.value.dose_note).toBe("400mg nightly");
      expect(r.value.started_at).toBeNull(); // server defaults to today
    }
  });

  it("rejects an unknown type and an empty label", () => {
    expect(validateInterventionInput({ type: "potion", label: "x" }).ok).toBe(false);
    expect(validateInterventionInput({ type: "diet", label: "   " }).ok).toBe(false);
  });

  it("accepts a valid start date and rejects an impossible one", () => {
    expect(
      validateInterventionInput({ type: "training", label: "Lifting", started_at: "2026-05-01" }).ok,
    ).toBe(true);
    expect(
      validateInterventionInput({ type: "training", label: "Lifting", started_at: "2026-02-31" }).ok,
    ).toBe(false);
  });

  it("treats a missing dose_note as null", () => {
    const r = validateInterventionInput({ type: "lifestyle", label: "Sleep by 10pm" });
    expect(r.ok && r.value.dose_note).toBeNull();
  });
});
