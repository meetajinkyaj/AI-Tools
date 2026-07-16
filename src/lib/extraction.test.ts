import { describe, expect, it } from "vitest";

import { type CatalogEntry } from "./biomarkers";
import {
  buildExtractionPrompt,
  extractJsonObject,
  hasUsableTextLayer,
  normalizeExtraction,
  parseExtractionResponse,
} from "./extraction";

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

const CATALOG: CatalogEntry[] = [
  entry({ marker_key: "ldl_c", display_name: "LDL Cholesterol" }),
  entry({ marker_key: "hdl_c", display_name: "HDL Cholesterol", ref_low: 40, ref_high: null }),
  entry({
    marker_key: "hiv",
    display_name: "HIV",
    category: "screening",
    unit: "",
    result_kind: "qualitative",
    normal_text: "Negative",
  }),
  entry({
    marker_key: "non_hdl_c",
    display_name: "Non-HDL Cholesterol",
    is_derived: true,
  }),
];

describe("buildExtractionPrompt", () => {
  it("lists allowed keys and excludes derived markers", () => {
    const p = buildExtractionPrompt(CATALOG);
    expect(p).toContain("ldl_c: LDL Cholesterol");
    expect(p).toContain("hiv: HIV");
    expect(p).toContain("qualitative");
    expect(p).toContain("normal: Negative");
    // Derived markers are computed by us, never extracted.
    expect(p).not.toContain("non_hdl_c");
  });
});

describe("extractJsonObject", () => {
  it("parses a bare object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses through ```json fences and prose", () => {
    const text = 'Here you go:\n```json\n{"markers":[]}\n```\nDone.';
    expect(extractJsonObject(text)).toEqual({ markers: [] });
  });
  it("returns null on junk", () => {
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject("{not valid}")).toBeNull();
  });
});

describe("normalizeExtraction", () => {
  it("keeps known numeric/qualitative markers and drops unknown & derived", () => {
    const result = normalizeExtraction(
      {
        test_date: "2026-05-22",
        lab_name: "  FITTR  ",
        markers: [
          { marker_key: "ldl_c", value: 107.7, ref_low: 0, ref_high: 130 },
          { marker_key: "hiv", value_text: "Negative" },
          { marker_key: "non_hdl_c", value: 90 }, // derived → dropped
          { marker_key: "made_up", value: 5 }, // unknown → dropped
        ],
        unmatched: ["Some Weird Panel"],
      },
      CATALOG,
    );
    expect(result.test_date).toBe("2026-05-22");
    expect(result.lab_name).toBe("FITTR");
    expect(result.readings.map((r) => r.marker_key)).toEqual(["ldl_c", "hiv"]);

    const ldl = result.readings[0];
    expect(ldl.value).toBe(107.7);
    expect(ldl.result_kind).toBe("numeric");
    expect(ldl.ref_high).toBe(130);

    const hiv = result.readings[1];
    expect(hiv.value).toBeNull();
    expect(hiv.value_text).toBe("Negative");
    expect(hiv.result_kind).toBe("qualitative");

    expect(result.unmatched).toEqual(["Some Weird Panel"]);
  });

  it("coerces numeric strings and drops non-numeric numeric markers", () => {
    const result = normalizeExtraction(
      {
        markers: [
          { marker_key: "ldl_c", value: "108" },
          { marker_key: "hdl_c", value: "n/a" },
        ],
      },
      CATALOG,
    );
    expect(result.readings.map((r) => r.marker_key)).toEqual(["ldl_c"]);
    expect(result.readings[0].value).toBe(108);
  });

  it("dedupes by marker_key (first wins) and drops empty qualitative text", () => {
    const result = normalizeExtraction(
      {
        markers: [
          { marker_key: "ldl_c", value: 100 },
          { marker_key: "ldl_c", value: 200 },
          { marker_key: "hiv", value_text: "  " },
        ],
      },
      CATALOG,
    );
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0].value).toBe(100);
  });

  it("rejects a future/invalid test date but keeps readings", () => {
    const result = normalizeExtraction(
      { test_date: "2999-01-01", markers: [{ marker_key: "ldl_c", value: 100 }] },
      CATALOG,
    );
    expect(result.test_date).toBeNull();
    expect(result.readings).toHaveLength(1);
  });

  it("never throws on garbage shapes", () => {
    expect(normalizeExtraction(null, CATALOG).readings).toEqual([]);
    expect(normalizeExtraction({ markers: "nope" }, CATALOG).readings).toEqual([]);
    expect(normalizeExtraction(42, CATALOG).readings).toEqual([]);
  });
});

describe("hasUsableTextLayer", () => {
  it("accepts a real text layer, rejects empty/sparse ones", () => {
    expect(hasUsableTextLayer("LDL Cholesterol ".repeat(50))).toBe(true);
    expect(hasUsableTextLayer("")).toBe(false);
    expect(hasUsableTextLayer(null)).toBe(false);
    expect(hasUsableTextLayer("   \n\n  ")).toBe(false);
    expect(hasUsableTextLayer("a few words only")).toBe(false); // scanned-PDF-like
  });
});

describe("parseExtractionResponse", () => {
  it("goes from raw fenced text to normalized readings", () => {
    const raw = '```json\n{"markers":[{"marker_key":"ldl_c","value":108}]}\n```';
    const result = parseExtractionResponse(raw, CATALOG);
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0].marker_key).toBe("ldl_c");
  });
});
