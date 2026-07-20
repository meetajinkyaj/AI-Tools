import { describe, expect, it } from "vitest";

import { POINTS, POINTS_REASON, uploadEarn } from "./points";

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
