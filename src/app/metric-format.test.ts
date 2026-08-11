import { describe, expect, it } from "vitest";

import { METRICS } from "@/lib/wearables/metrics";
import { display } from "./metric-format";

/**
 * One formatter, two screens.
 *
 * "From your devices" shows the merged answer and "What your Whoop says" shows
 * what one device sent. Somebody reconciling our figures against the vendor's
 * app reads both, and the reconciliation only works if a number is written the
 * same way in each. This used to be two copies of one function with different
 * signatures, which is the setup for exactly that kind of drift.
 */

describe("display", () => {
  it("writes sleep as hours and minutes, with no trailing unit", () => {
    expect(display("sleep_minutes", 408, "min")).toEqual({ value: "6h 48m", unit: "" });
  });

  it("pads the minutes, so 6h 5m does not read as 6h 50m", () => {
    expect(display("sleep_minutes", 365, "min").value).toBe("6h 05m");
  });

  it("groups a step count", () => {
    expect(display("steps", 11583, "count").value).toBe("11,583");
  });

  it("says nothing after a score or a count, which are not units", () => {
    // "55 score" and "9,000 count" both read as a bug.
    expect(display("sleep_score", 83, "score").unit).toBe("");
    expect(display("steps", 11583, "count").unit).toBe("");
  });

  it("keeps a decimal where the unit implies one", () => {
    expect(display("spo2", 97.4, "%")).toEqual({ value: "97.4", unit: "%" });
    expect(display("respiratory_rate", 14.6, "brpm")).toEqual({ value: "14.6", unit: "brpm" });
  });

  it("separates the unit from the figure", () => {
    // They are set differently: the number is the thing being read, the unit is
    // there for the second glance.
    expect(display("resting_heart_rate", 59, "bpm")).toEqual({ value: "59", unit: "bpm" });
  });

  it("takes the metric's own precision over the unit's when it has one", () => {
    /*
     * THE DISAGREEMENT THIS FIXES. Skin temperature deviation is stored to two
     * places and its unit implies none, so the per-device panel showed -0.24
     * and the merged card showed -0 for the same reading. Two screens, one
     * number, and no way for a member to tell which was the bug.
     */
    const { precision, unit } = METRICS.temperature_deviation;
    expect(display("temperature_deviation", -0.24, unit, precision).value).toBe("-0.24");
  });

  it("still formats sleep as a duration when a precision is passed", () => {
    expect(display("sleep_minutes", 408, "min", 0).value).toBe("6h 48m");
  });
});
