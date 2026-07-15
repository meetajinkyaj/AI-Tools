import { describe, expect, it } from "vitest";

import {
  type CatalogEntry,
  computeFlag,
  dedupeCatalogForSex,
  groupByCategory,
  isValidDate,
  validatePanelInput,
} from "./biomarkers";

function entry(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    marker_key: "ldl_c",
    display_name: "LDL Cholesterol",
    category: "lipids",
    unit: "mg/dL",
    sex: "any",
    ref_low: 0,
    ref_high: 100,
    direction: "lower_better",
    sort_order: 10,
    ...over,
  };
}

describe("computeFlag", () => {
  it("flags below/above/within a range", () => {
    expect(computeFlag(120, 0, 100)).toBe("high");
    expect(computeFlag(80, 0, 100)).toBe("in_range");
    expect(computeFlag(30, 40, null)).toBe("low"); // HDL-style, low bound only
    expect(computeFlag(50, 40, null)).toBe("in_range");
  });
  it("is unknown with no range", () => {
    expect(computeFlag(5, null, null)).toBe("unknown");
  });
});

describe("dedupeCatalogForSex", () => {
  const rows: CatalogEntry[] = [
    entry({ marker_key: "hdl_c", sex: "male", ref_low: 40, sort_order: 12 }),
    entry({ marker_key: "hdl_c", sex: "female", ref_low: 50, sort_order: 13 }),
    entry({ marker_key: "ldl_c", sex: "any", sort_order: 10 }),
  ];
  it("prefers the sex-specific row, else 'any', sorted by order", () => {
    const male = dedupeCatalogForSex(rows, "male");
    expect(male.map((e) => e.marker_key)).toEqual(["ldl_c", "hdl_c"]);
    expect(male.find((e) => e.marker_key === "hdl_c")?.ref_low).toBe(40);

    const female = dedupeCatalogForSex(rows, "female");
    expect(female.find((e) => e.marker_key === "hdl_c")?.ref_low).toBe(50);
  });
  it("falls back to 'any' when no sex match", () => {
    const only = dedupeCatalogForSex([entry({ marker_key: "tsh", sex: "any" })], "male");
    expect(only).toHaveLength(1);
  });
});

describe("groupByCategory", () => {
  it("groups preserving order", () => {
    const groups = groupByCategory([
      entry({ marker_key: "ldl_c", category: "lipids" }),
      entry({ marker_key: "tsh", category: "thyroid" }),
      entry({ marker_key: "hdl_c", category: "lipids" }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["lipids", "thyroid"]);
    expect(groups[0].entries).toHaveLength(2);
  });
});

describe("validatePanelInput", () => {
  it("accepts a valid body and coerces numeric strings", () => {
    const r = validatePanelInput({
      test_date: "2026-05-22",
      lab_name: "  FITTR  ",
      readings: [
        { marker_key: "ldl_c", value: 107.77 },
        { marker_key: "hdl_c", value: "66" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.lab_name).toBe("FITTR");
      expect(r.value.readings[1].value).toBe(66);
    }
  });

  it("requires at least one reading", () => {
    expect(validatePanelInput({ readings: [] }).ok).toBe(false);
    expect(validatePanelInput({}).ok).toBe(false);
  });

  it("rejects a non-numeric value and a future/invalid date", () => {
    expect(
      validatePanelInput({ readings: [{ marker_key: "ldl_c", value: "abc" }] }).ok,
    ).toBe(false);
    expect(
      validatePanelInput({
        test_date: "2999-01-01",
        readings: [{ marker_key: "ldl_c", value: 100 }],
      }).ok,
    ).toBe(false);
  });
});

describe("isValidDate", () => {
  it("accepts a real past date, rejects impossible/future", () => {
    expect(isValidDate("2026-05-22")).toBe(true);
    expect(isValidDate("2026-02-31")).toBe(false);
    expect(isValidDate("2999-01-01")).toBe(false);
  });
});
