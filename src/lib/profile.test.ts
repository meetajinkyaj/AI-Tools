import { describe, expect, it } from "vitest";

import { isValidDateOfBirth, validateProfileInput } from "./profile";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    full_name: "  Ada Lovelace  ",
    date_of_birth: "1990-05-20",
    biological_sex: "female",
    primary_goal: "longevity",
    activity_level: "moderate",
    timezone: "Europe/London",
    marketing_consent: true,
    ...overrides,
  };
}

describe("validateProfileInput", () => {
  it("accepts and normalizes a valid body", () => {
    const result = validateProfileInput(validBody());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.full_name).toBe("Ada Lovelace"); // trimmed
      expect(result.value.biological_sex).toBe("female");
      expect(result.value.marketing_consent).toBe(true);
      expect(result.value.timezone).toBe("Europe/London");
    }
  });

  it("defaults marketing_consent to false and timezone to null", () => {
    const result = validateProfileInput(
      validBody({ marketing_consent: undefined, timezone: "  " }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.marketing_consent).toBe(false);
      expect(result.value.timezone).toBeNull();
    }
  });

  it("rejects a missing name", () => {
    expect(validateProfileInput(validBody({ full_name: "   " }))).toMatchObject({
      ok: false,
    });
  });

  it("rejects invalid enum values", () => {
    expect(
      validateProfileInput(validBody({ biological_sex: "other" })).ok,
    ).toBe(false);
    expect(validateProfileInput(validBody({ primary_goal: "bulking" })).ok).toBe(
      false,
    );
    expect(
      validateProfileInput(validBody({ activity_level: "extreme" })).ok,
    ).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(validateProfileInput(null).ok).toBe(false);
    expect(validateProfileInput("nope").ok).toBe(false);
  });

  it("rejects a bad date of birth", () => {
    expect(validateProfileInput(validBody({ date_of_birth: "20-05-1990" })).ok).toBe(false);
    expect(validateProfileInput(validBody({ date_of_birth: "1990-02-31" })).ok).toBe(false);
  });
});

describe("isValidDateOfBirth", () => {
  it("accepts a plausible adult birth date", () => {
    expect(isValidDateOfBirth("1985-01-01")).toBe(true);
  });

  it("rejects impossible calendar dates", () => {
    expect(isValidDateOfBirth("2021-13-01")).toBe(false);
    expect(isValidDateOfBirth("2021-04-31")).toBe(false);
  });

  it("rejects future dates", () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    expect(isValidDateOfBirth(`${nextYear}-01-01`)).toBe(false);
  });

  it("rejects implausible ages", () => {
    const tooYoung = new Date().getUTCFullYear() - 5;
    expect(isValidDateOfBirth(`${tooYoung}-01-01`)).toBe(false);
    expect(isValidDateOfBirth("1850-01-01")).toBe(false);
  });
});
