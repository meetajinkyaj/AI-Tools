import { describe, expect, it } from "vitest";

import { formatPanelDate, panelSubtitle } from "./biomarker-report";

/**
 * The line under "Your baseline".
 *
 * It used to read "2026-05-12 · FITTR", which is two database columns printed
 * side by side. The two questions somebody actually arrives with are how old
 * this panel is and whether we got all of it, so it now answers both.
 */

const panel = {
  id: "p1",
  test_date: "2026-05-12",
  lab_name: "FITTR",
  source: "pdf_upload",
  created_at: "2026-08-01T09:12:00.000Z",
};

describe("formatPanelDate", () => {
  it("writes the date out", () => {
    expect(formatPanelDate("2026-05-12")).toBe("12 May 2026");
  });

  it("does not shift the day for readers west of Greenwich", () => {
    /*
     * The reason this is hand-parsed. `new Date("2026-05-12")` is midnight UTC,
     * and printing it in a New York timezone gives 11 May. A lab date that is
     * one day out is exactly the kind of small wrongness a health app cannot
     * afford, and it would only be visible to some of the people using it.
     */
    const original = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(formatPanelDate("2026-05-12")).toBe("12 May 2026");
    } finally {
      process.env.TZ = original;
    }
  });

  it("reads a date out of a timestamp", () => {
    expect(formatPanelDate("2026-08-01T09:12:00.000Z")).toBe("1 Aug 2026");
  });

  it("returns nothing it cannot parse, rather than 'Invalid Date'", () => {
    expect(formatPanelDate("")).toBe("");
    expect(formatPanelDate("last Tuesday")).toBe("");
    expect(formatPanelDate("2026-13-01")).toBe("");
  });
});

describe("panelSubtitle", () => {
  it("says when the blood was taken, where, and how much we read", () => {
    expect(panelSubtitle(panel, 34)).toBe("Tested 12 May 2026 · FITTR · 34 markers read from your PDF");
  });

  it("says Tested, not Uploaded, when we hold a test date", () => {
    // The mockup's copy reads "Uploaded". The sample date and the upload date
    // are different days, often weeks apart, and labelling one as the other
    // misdates somebody's blood work.
    expect(panelSubtitle(panel, 34)).toContain("Tested");
    expect(panelSubtitle(panel, 34)).not.toContain("Uploaded");
  });

  it("falls back to the upload date when the panel has no test date", () => {
    expect(panelSubtitle({ ...panel, test_date: null }, 12)).toContain("Uploaded 1 Aug 2026");
  });

  it("does not claim a PDF for markers somebody typed in", () => {
    expect(panelSubtitle({ ...panel, source: "manual" }, 6)).toContain("6 markers entered by hand");
  });

  it("counts one marker in the singular", () => {
    expect(panelSubtitle(panel, 1)).toContain("1 marker read from your PDF");
  });

  it("keeps the lab name, which the mockup drops", () => {
    // Provenance is the first thing a clinician asks about a result.
    expect(panelSubtitle(panel, 34)).toContain("FITTR");
  });

  it("omits the count rather than printing a zero", () => {
    expect(panelSubtitle(panel, 0)).toBe("Tested 12 May 2026 · FITTR");
  });

  it("has something to say about a panel with nothing on it", () => {
    expect(panelSubtitle({ ...panel, test_date: null, lab_name: null, created_at: "" }, 0)).toBe(
      "Your latest panel",
    );
  });

  it("is empty when there is no panel at all", () => {
    expect(panelSubtitle(undefined, 0)).toBe("");
  });
});
