import { describe, expect, it } from "vitest";

import {
  bandFor,
  type CatalogEntry,
  computeDerived,
  computeFlag,
  dedupeCatalogForSex,
  groupByCategory,
  isEnterableNumeric,
  isValidDate,
  qualitativeFlag,
  qualitativeOptions,
  validatePanelInput,
} from "./biomarkers";

const VITD_BANDS = [
  { label: "Deficiency", high: 20, severity: "low" },
  { label: "Insufficiency", low: 20, high: 30, severity: "borderline" },
  { label: "Sufficiency", low: 30, high: 100, severity: "optimal" },
  { label: "Toxicity", low: 100, severity: "high" },
];

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
    result_kind: "numeric",
    is_derived: false,
    normal_text: null,
    bands: [],
    ...over,
  };
}

describe("isEnterableNumeric", () => {
  it("is true only for numeric, non-derived markers", () => {
    expect(isEnterableNumeric(entry())).toBe(true);
    expect(isEnterableNumeric(entry({ is_derived: true }))).toBe(false);
    expect(isEnterableNumeric(entry({ result_kind: "qualitative" }))).toBe(false);
  });
});

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

describe("qualitativeFlag / qualitativeOptions", () => {
  it("flags a match as in range and a mismatch otherwise (case-insensitive)", () => {
    expect(qualitativeFlag("negative", "Negative")).toBe("in_range");
    expect(qualitativeFlag("Positive", "Negative")).toBe("high");
    expect(qualitativeFlag("Reactive", null)).toBe("unknown");
  });
  it("offers [normal, abnormal] choices", () => {
    expect(qualitativeOptions("Negative")).toEqual(["Negative", "Positive"]);
    expect(qualitativeOptions("Non-reactive")).toEqual(["Non-reactive", "Reactive"]);
    expect(qualitativeOptions("Absent")).toEqual(["Absent", "Present"]);
  });
});

describe("bandFor", () => {
  it("finds the band a value sits in (high exclusive)", () => {
    expect(bandFor(23.4, VITD_BANDS)?.label).toBe("Insufficiency");
    expect(bandFor(30, VITD_BANDS)?.label).toBe("Sufficiency");
    expect(bandFor(8, VITD_BANDS)?.label).toBe("Deficiency");
    expect(bandFor(120, VITD_BANDS)?.label).toBe("Toxicity");
  });
});

describe("computeDerived", () => {
  it("computes markers whose inputs are present", () => {
    const m = new Map<string, number>([
      ["total_cholesterol", 185],
      ["hdl_c", 66],
      ["ldl_c", 108],
      ["triglycerides", 55],
      ["hba1c", 5.0],
    ]);
    const out = new Map(computeDerived(m).map((d) => [d.marker_key, d.value]));
    expect(out.get("non_hdl_c")).toBe(119);
    expect(out.get("tc_hdl_ratio")).toBe(2.8);
    expect(out.get("vldl")).toBe(11);
    expect(out.get("ldl_hdl_ratio")).toBe(1.64);
    expect(out.get("hba1c_eag")).toBe(97); // 28.7*5 - 46.7 = 96.8
  });
  it("skips derived markers with missing inputs", () => {
    const out = computeDerived(new Map([["triglycerides", 100]]));
    expect(out.map((d) => d.marker_key)).toEqual(["vldl"]);
  });
});

describe("validatePanelInput — qualitative & range override", () => {
  it("accepts a qualitative reading and a lab range override", () => {
    const r = validatePanelInput({
      readings: [
        { marker_key: "hiv", value_text: "Negative" },
        { marker_key: "ldl_c", value: 108, ref_low: 0, ref_high: 130 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.readings[0].value_text).toBe("Negative");
      expect(r.value.readings[0].value).toBeNull();
      expect(r.value.readings[1].ref_high).toBe(130);
    }
  });
  it("rejects a reading with neither value nor value_text", () => {
    expect(validatePanelInput({ readings: [{ marker_key: "ldl_c" }] }).ok).toBe(false);
  });
});
