import { describe, expect, it } from "vitest";

import {
  BIOMARKER_OVERLAPS,
  overlapsFor,
  preferBiomarker,
} from "./biomarker-overlap";
import { isMetricKey } from "./metrics";

/**
 * These tests are mostly about one thing: the rule "blood always beats the
 * wearable" is intuitive, wrong, and will be reintroduced by someone who has
 * not read the table. So the inversion is asserted directly, by name.
 */

describe("the precedence rule", () => {
  it("prefers the lab HbA1c over the CGM estimate", () => {
    expect(preferBiomarker("hba1c_estimated", "hba1c")).toBe(true);
  });

  it("PREFERS THE CGM over the lab-derived average glucose", () => {
    // The one that inverts. `hba1c_eag` is a population regression from lab
    // HbA1c (28.7 x hba1c - 46.7); a CGM measures mean glucose directly. If
    // this ever flips to true, someone has applied instrument seniority
    // instead of asking which one measured the quantity.
    expect(preferBiomarker("glucose_avg", "hba1c_eag")).toBe(false);
  });

  it("refuses to rank fasting glucose against a 24-hour mean", () => {
    // null means "show both, separately", NOT "no preference, pick either".
    expect(preferBiomarker("glucose_avg", "glucose_fasting")).toBeNull();
  });

  it("refuses to rank a vendor composite against a measured marker", () => {
    expect(preferBiomarker("metabolic_score", "hba1c")).toBeNull();
  });

  it("returns null for a pair that does not overlap at all", () => {
    // Steps and HbA1c share no territory. Callers must not read this as
    // "wearable wins".
    expect(preferBiomarker("steps", "hba1c")).toBeNull();
    expect(preferBiomarker("hba1c_estimated", "ldl_c")).toBeNull();
  });
});

describe("the table itself", () => {
  it("only names metrics that exist in the vocabulary", () => {
    // A typo here would silently make an overlap unreachable, since lookups
    // are by exact key.
    for (const o of BIOMARKER_OVERLAPS) {
      expect(isMetricKey(o.wearable), o.wearable).toBe(true);
    }
  });

  it("names each biomarker with a catalog marker_key, not a label", () => {
    for (const o of BIOMARKER_OVERLAPS) {
      expect(o.biomarker, o.biomarker).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("records no pair twice", () => {
    const pairs = BIOMARKER_OVERLAPS.map((o) => `${o.wearable}:${o.biomarker}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("explains every entry, because the reason is the point of the file", () => {
    for (const o of BIOMARKER_OVERLAPS) {
      expect(o.why.length, o.wearable).toBeGreaterThan(80);
    }
  });

  it("covers both directions and the refusal, so no reader mistakes it for a hierarchy", () => {
    const kinds = new Set(BIOMARKER_OVERLAPS.map((o) => o.prefer));
    expect(kinds).toEqual(new Set(["biomarker", "wearable", "neither"]));
  });
});

describe("overlapsFor", () => {
  it("returns every marker a metric touches", () => {
    const markers = overlapsFor("glucose_avg").map((o) => o.biomarker);
    expect(markers).toContain("hba1c_eag");
    expect(markers).toContain("glucose_fasting");
  });

  it("returns nothing for a metric with no blood counterpart", () => {
    expect(overlapsFor("steps")).toEqual([]);
    expect(overlapsFor("sleep_minutes")).toEqual([]);
  });
});
