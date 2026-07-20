import { describe, expect, it } from "vitest";

import {
  POINTS,
  POINTS_REASON,
  isReplayUpload,
  panelContentSignature,
  uploadEarn,
} from "./points";

describe("uploadEarn", () => {
  it("rewards the first-ever panel with the first-upload bonus", () => {
    expect(uploadEarn("2026-01-01", [])).toEqual({
      amount: POINTS.firstPanelUpload,
      reason: POINTS_REASON.panelUpload,
    });
    // even undated, the first panel still earns the first-upload bonus
    expect(uploadEarn(null, [])).toEqual({
      amount: POINTS.firstPanelUpload,
      reason: POINTS_REASON.panelUpload,
    });
  });

  it("rewards a genuinely new dated re-test", () => {
    expect(uploadEarn("2026-02-01", ["2026-01-01"])).toEqual({
      amount: POINTS.reTestUpload,
      reason: POINTS_REASON.reTest,
    });
  });

  it("does not reward re-saving a date already on file (anti-farm)", () => {
    expect(uploadEarn("2026-01-01", ["2026-01-01"])).toBeNull();
    expect(uploadEarn("2026-01-01", ["2026-02-01", "2026-01-01"])).toBeNull();
  });

  it("does not reward an undated re-save once a panel exists", () => {
    expect(uploadEarn(null, ["2026-01-01"])).toBeNull();
  });

  it("is retunable purely from the POINTS table", () => {
    // The earn amounts come straight from POINTS — scaling the economy is a
    // one-line change there, never in the awarding logic.
    expect(uploadEarn("2026-02-01", [])!.amount).toBe(POINTS.firstPanelUpload);
    expect(uploadEarn("2026-02-01", ["2026-01-01"])!.amount).toBe(
      POINTS.reTestUpload,
    );
  });
});

describe("panelContentSignature", () => {
  it("is independent of reading order", () => {
    const a = panelContentSignature([
      { marker_key: "ldl", value: 100 },
      { marker_key: "hdl", value: 55 },
    ]);
    const b = panelContentSignature([
      { marker_key: "hdl", value: 55 },
      { marker_key: "ldl", value: 100 },
    ]);
    expect(a).toBe(b);
  });

  it("changes when any value changes", () => {
    const base = panelContentSignature([{ marker_key: "ldl", value: 100 }]);
    const changed = panelContentSignature([{ marker_key: "ldl", value: 101 }]);
    expect(base).not.toBe(changed);
  });

  it("includes qualitative value_text in the signature", () => {
    const a = panelContentSignature([
      { marker_key: "hbsag", value: null, value_text: "Non Reactive" },
    ]);
    const b = panelContentSignature([
      { marker_key: "hbsag", value: null, value_text: "Reactive" },
    ]);
    expect(a).not.toBe(b);
  });
});

describe("isReplayUpload", () => {
  it("flags a re-upload of the same report regardless of test date", () => {
    const readings = [
      { marker_key: "ldl", value: 100 },
      { marker_key: "hdl", value: 55 },
    ];
    const sig = panelContentSignature(readings);
    // Prior panel with identical content but saved under a different date.
    const priorSig = panelContentSignature([
      { marker_key: "hdl", value: 55 },
      { marker_key: "ldl", value: 100 },
    ]);
    expect(isReplayUpload(sig, [priorSig])).toBe(true);
  });

  it("does not flag genuinely different content", () => {
    const sig = panelContentSignature([{ marker_key: "ldl", value: 100 }]);
    const priorSig = panelContentSignature([{ marker_key: "ldl", value: 120 }]);
    expect(isReplayUpload(sig, [priorSig])).toBe(false);
  });

  it("does not flag the first-ever panel (no priors)", () => {
    const sig = panelContentSignature([{ marker_key: "ldl", value: 100 }]);
    expect(isReplayUpload(sig, [])).toBe(false);
  });
});

/**
 * The product contract: a user must never earn upload points by resubmitting the
 * same report — whether they keep its date, change its date, or re-upload it
 * across many days/months. The save route enforces this by composing the two
 * guards below (replay-by-content first, then earn-by-date). This block mirrors
 * that composition so neither guard can be silently dropped in a refactor.
 */
describe("anti-farm contract: the same report never earns twice", () => {
  interface Panel {
    testDate: string | null;
    readings: SignatureReading[];
  }

  /** The route's decision: award only when NOT a content replay AND the date
   * logic grants an earn. Mirrors awardPanelPoints in the biomarkers route. */
  function earnsUploadPoints(newPanel: Panel, priorPanels: Panel[]): boolean {
    const newSig = panelContentSignature(newPanel.readings);
    const priorSigs = priorPanels.map((p) => panelContentSignature(p.readings));
    if (isReplayUpload(newSig, priorSigs)) return false; // content replay
    return uploadEarn(newPanel.testDate, priorPanels.map((p) => p.testDate)) != null;
  }

  const baseline: Panel = {
    testDate: "2026-05-22",
    readings: [
      { marker_key: "ldl", value: 120 },
      { marker_key: "hdl", value: 45 },
    ],
  };

  it("earns on the first-ever panel", () => {
    expect(earnsUploadPoints(baseline, [])).toBe(true);
  });

  it("earns nothing re-saving the exact same report (same date, same content)", () => {
    expect(earnsUploadPoints(baseline, [baseline])).toBe(false);
  });

  it("earns nothing re-saving the same report under a NEW date (content replay)", () => {
    const reDated: Panel = { testDate: "2026-06-20", readings: baseline.readings };
    expect(earnsUploadPoints(reDated, [baseline])).toBe(false);
  });

  it("earns nothing re-saving the same report DATE with different content", () => {
    const sameDate: Panel = {
      testDate: "2026-05-22",
      readings: [{ marker_key: "ldl", value: 118 }],
    };
    expect(earnsUploadPoints(sameDate, [baseline])).toBe(false);
  });

  it("earns nothing however many times the same report is resubmitted over months", () => {
    const priors = [
      baseline,
      { testDate: "2026-06-20", readings: baseline.readings },
      { testDate: "2026-07-15", readings: baseline.readings },
    ];
    const yetAnother: Panel = { testDate: "2026-08-30", readings: baseline.readings };
    expect(earnsUploadPoints(yetAnother, priors)).toBe(false);
  });

  it("still earns for a genuine re-test (new date AND new values)", () => {
    const reTest: Panel = {
      testDate: "2026-11-22",
      readings: [
        { marker_key: "ldl", value: 95 },
        { marker_key: "hdl", value: 52 },
      ],
    };
    expect(earnsUploadPoints(reTest, [baseline])).toBe(true);
  });
});
