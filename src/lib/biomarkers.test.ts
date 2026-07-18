import { describe, expect, it } from "vitest";

import {
  type Band,
  bandFor,
  canonicalizeCount,
  type CatalogEntry,
  computeDerived,
  computeFlag,
  dedupeCatalogForSex,
  groupByCategory,
  isEnterableNumeric,
  isNoteworthy,
  isValidDate,
  qualitativeFlag,
  qualitativeOptions,
  severityFromBand,
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

describe("severityFromBand", () => {
  const ldlBands: Band[] = [
    { label: "Optimal", high: 100, severity: "optimal" },
    { label: "Near optimal", low: 100, high: 130, severity: "borderline" },
    { label: "High", low: 160, severity: "high" },
  ];
  it("uses the band's severity when a band is present (pill agrees with callout)", () => {
    // LDL 107.77 flags 'high' vs a 0–100 range, but sits in the 'Near optimal'
    // (borderline) band — the band should win so the two labels agree.
    expect(severityFromBand("high", bandFor(107.77, ldlBands))).toBe("borderline");
    expect(severityFromBand("high", bandFor(180, ldlBands))).toBe("high");
    expect(severityFromBand("in_range", bandFor(80, ldlBands))).toBe("optimal");
  });
  it("falls back to the numeric flag with no band", () => {
    expect(severityFromBand("high", null)).toBe("high");
    expect(severityFromBand("low", null)).toBe("low");
    expect(severityFromBand("in_range", null)).toBe("in_range");
  });
});

describe("isNoteworthy", () => {
  it("surfaces low/high/borderline, not optimal/in_range/unknown", () => {
    expect(["low", "high", "borderline"].every(isNoteworthy)).toBe(true);
    expect(["optimal", "in_range", "unknown"].some(isNoteworthy)).toBe(false);
  });
});

describe("canonicalizeCount", () => {
  it("scales raw cell counts to the catalog's canonical unit", () => {
    expect(canonicalizeCount("wbc", 6870)).toBe(6.87); // /µL -> 10^3/µL
    expect(canonicalizeCount("platelets", 171000)).toBe(171);
    expect(canonicalizeCount("rbc", 4_700_000)).toBe(4.7); // /µL -> million/µL
  });
  it("leaves already-canonical values and unknown markers untouched", () => {
    expect(canonicalizeCount("wbc", 6.87)).toBe(6.87);
    expect(canonicalizeCount("platelets", 171)).toBe(171);
    expect(canonicalizeCount("ldl_c", 107.77)).toBe(107.77);
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
