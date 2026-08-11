import { describe, expect, it } from "vitest";

import { METRICS } from "@/lib/wearables/metrics";
import { METRIC_GLYPHS } from "./metric-icon";
import { display, movement, recencyLabel, rowNote } from "./wearable-trends";

/**
 * The device panel on Trends.
 *
 * It was rebuilt because the old version drew a sparkline on every row,
 * including rows holding two readings, where a two-point line normalised to its
 * own range is a 45-degree diagonal whatever the numbers did. Six of those read
 * as six trends and were six pieces of noise. These tests hold the pieces of
 * that fix which can be checked without a browser: how a number is written, how
 * old it is, and whether it moved.
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

  it("keeps a decimal where the metric has one", () => {
    expect(display("spo2", 97.4, "%")).toEqual({ value: "97.4", unit: "%" });
    expect(display("respiratory_rate", 14.6, "brpm")).toEqual({ value: "14.6", unit: "brpm" });
  });

  it("separates the unit from the figure", () => {
    // They are styled differently: the number is the thing being read, the unit
    // is there for the second glance.
    expect(display("resting_heart_rate", 59, "bpm")).toEqual({ value: "59", unit: "bpm" });
  });
});

describe("recencyLabel", () => {
  it("names today and yesterday", () => {
    expect(recencyLabel("2026-08-11", "2026-08-11")).toBe("Today");
    expect(recencyLabel("2026-08-10", "2026-08-11")).toBe("Yesterday");
  });

  it("counts the days inside a week", () => {
    expect(recencyLabel("2026-08-08", "2026-08-11")).toBe("3 days ago");
  });

  it("dates anything older, since 'nine days ago' is not how anybody thinks", () => {
    expect(recencyLabel("2026-07-30", "2026-08-11")).toBe("30 Jul");
  });

  it("counts across a month boundary", () => {
    // A big number with no date on it is read as this morning's. A strap left
    // on the charger must not present a stale reading as current.
    expect(recencyLabel("2026-07-31", "2026-08-02")).toBe("2 days ago");
  });

  it("says nothing it cannot parse", () => {
    expect(recencyLabel("", "2026-08-11")).toBe("");
    expect(recencyLabel("not-a-date", "2026-08-11")).toBe("");
  });
});

describe("movement", () => {
  it("reports which way the reading went", () => {
    expect(movement(59, 57)).toBe("up");
    expect(movement(53, 57)).toBe("down");
  });

  it("calls an identical reading level", () => {
    expect(movement(59, 59)).toBe("level");
  });

  it("does not draw an arrow on a rounding-level difference", () => {
    // Sleep in minutes and steps in thousands routinely differ by a hair, and
    // an arrow on a 0.1% change is a claim the data is not making.
    expect(movement(11583, 11580)).toBe("level");
    expect(movement(420, 419)).toBe("level");
  });

  it("still moves on a small change to a small number", () => {
    expect(movement(4, 3)).toBe("up");
  });
});

describe("rowNote", () => {
  const points = [
    { date: "2026-08-09", value: 57, source: "whoop" },
    { date: "2026-08-10", value: 53, source: "whoop" },
  ];

  it("leaves the device out when there is only one", () => {
    // The screenshot that started the rebuild said "Whoop · 2 days" six times
    // down one card. With one device the name belongs in the header, once.
    expect(rowNote({ sources: ["whoop"], points }, "2026-08-11", false)).toBe(
      "Yesterday · 2 days",
    );
  });

  it("names the devices when there is more than one", () => {
    // Then it answers a real question: which of mine is this number from.
    expect(rowNote({ sources: ["whoop", "oura"], points }, "2026-08-11", true)).toBe(
      "Whoop + Oura · Yesterday · 2 days",
    );
  });

  it("is identical across metrics that share a device and a sync", () => {
    // Which is what lets the card hoist it into the header and print it once.
    const a = rowNote({ sources: ["whoop"], points }, "2026-08-11", false);
    const b = rowNote({ sources: ["whoop"], points: [...points] }, "2026-08-11", false);
    expect(new Set([a, b]).size).toBe(1);
  });

  it("differs the moment one metric is thinner than another", () => {
    const thin = rowNote({ sources: ["whoop"], points: points.slice(1) }, "2026-08-11", false);
    const full = rowNote({ sources: ["whoop"], points }, "2026-08-11", false);
    expect(thin).toBe("Yesterday · 1 day");
    expect(thin).not.toBe(full);
  });
});

describe("the icon set", () => {
  it("has a glyph for every metric in the vocabulary", () => {
    // A new metric key with no icon still renders (it falls through to the
    // gauge), so nothing breaks visibly. This is the reminder to choose one.
    for (const key of Object.keys(METRICS)) {
      expect(METRIC_GLYPHS, key).toHaveProperty(key);
    }
  });
});
