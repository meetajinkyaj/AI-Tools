import { describe, expect, it } from "vitest";

import { summarizePanel } from "./panel-summary";

/**
 * The count behind both "31 of 34" on Home and the Report hero. One rule, so
 * the two screens can never disagree about the same panel.
 */
describe("summarizePanel", () => {
  const r = (marker_key: string, flag: "in_range" | "low" | "high", kind = "numeric") => ({
    marker_key,
    value: 10,
    result_kind: kind,
    flag,
  });

  it("counts flagged markers as worth a look and the rest as in range", () => {
    const out = summarizePanel([r("a", "in_range"), r("b", "low"), r("c", "high")], []);
    expect(out.total).toBe(3);
    expect(out.inRange).toBe(1);
    expect(out.worthALook.map((x) => x.marker_key)).toEqual(["b", "c"]);
  });

  it("treats a qualitative result outside normal as worth a look", () => {
    const out = summarizePanel([r("q", "high", "qualitative"), r("n", "in_range", "qualitative")], []);
    expect(out.inRange).toBe(1);
  });

  it("is empty for an empty panel", () => {
    expect(summarizePanel([], [])).toEqual({ worthALook: [], inRange: 0, total: 0 });
  });
});
