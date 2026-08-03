import { describe, expect, it } from "vitest";

import { measuredSleepHours, mergeMetrics, recentAverage, SOURCE_RANK, type MetricRow } from "./merge";
import { METRIC_KEYS } from "./metrics";
import { PROVIDER_IDS, PROVIDERS } from "./providers";
import { PROVIDER_NAMES } from "./types";

/**
 * The merge is where multiple devices either become one coherent picture or a
 * pile of contradictions. These tests pin the behaviour that makes the
 * difference: coverage across sources, one winner per day, and never inventing
 * a number no device reported.
 */

const row = (
  provider: string,
  date: string,
  metric: string,
  value: number | string,
): MetricRow => ({ provider, metric_date: date, metric, value });

describe("resolving several devices onto one series", () => {
  it("prefers the better source for the metric, per day", () => {
    // Ring and watch both logged the same night. The ring is worn to bed and
    // is what the user would check in Oura's own app, so it wins.
    const merged = mergeMetrics([
      row("fitbit", "2026-07-04", "sleep_minutes", 402),
      row("oura", "2026-07-04", "sleep_minutes", 431),
    ]);
    expect(merged[0].points).toEqual([
      { date: "2026-07-04", value: 431, source: "oura" },
    ]);
  });

  it("falls back per DAY, not per series, this is the whole point", () => {
    // The night the ring was on the charger still has data, from the watch.
    // A per-series winner would have thrown that night away entirely.
    const merged = mergeMetrics([
      row("oura", "2026-07-04", "sleep_minutes", 431),
      row("fitbit", "2026-07-04", "sleep_minutes", 402),
      row("fitbit", "2026-07-05", "sleep_minutes", 388),
      row("oura", "2026-07-06", "sleep_minutes", 455),
    ]);
    expect(merged[0].points).toEqual([
      { date: "2026-07-04", value: 431, source: "oura" },
      { date: "2026-07-05", value: 388, source: "fitbit" },
      { date: "2026-07-06", value: 455, source: "oura" },
    ]);
  });

  it("never averages", () => {
    // Averaging produces a number neither device reported and nobody can
    // reconcile against their own app.
    const merged = mergeMetrics([
      row("oura", "2026-07-04", "sleep_minutes", 400),
      row("whoop", "2026-07-04", "sleep_minutes", 500),
    ]);
    expect(merged[0].points[0].value).toBe(400);
    expect(merged[0].points[0].value).not.toBe(450);
  });

  it("routes each metric to the device built to measure it", () => {
    // Same two devices, opposite winners: a ring under-reports steps, a watch
    // is not reliably worn to bed.
    const merged = mergeMetrics([
      row("oura", "2026-07-04", "steps", 6_100),
      row("garmin", "2026-07-04", "steps", 9_240),
      row("oura", "2026-07-04", "hrv", 62),
      row("garmin", "2026-07-04", "hrv", 55),
    ]);
    const steps = merged.find((s) => s.metric === "steps")!;
    const hrv = merged.find((s) => s.metric === "hrv")!;
    expect(steps.points[0]).toMatchObject({ value: 9_240, source: "garmin" });
    expect(hrv.points[0]).toMatchObject({ value: 62, source: "oura" });
  });

  it("gives the scale body composition, since nothing else measures it", () => {
    const merged = mergeMetrics([
      row("fitbit", "2026-07-04", "weight_kg", 74.2),
      row("withings", "2026-07-04", "weight_kg", 73.8),
    ]);
    expect(merged[0].points[0]).toMatchObject({ value: 73.8, source: "withings" });
  });

  it("lists every contributing source, best first", () => {
    const merged = mergeMetrics([
      row("fitbit", "2026-07-05", "sleep_minutes", 388),
      row("oura", "2026-07-04", "sleep_minutes", 431),
    ]);
    expect(merged[0].sources).toEqual(["oura", "fitbit"]);
  });

  it("is order-independent", () => {
    const rows = [
      row("fitbit", "2026-07-04", "sleep_minutes", 402),
      row("oura", "2026-07-04", "sleep_minutes", 431),
      row("whoop", "2026-07-04", "sleep_minutes", 410),
    ];
    const a = mergeMetrics(rows);
    const b = mergeMetrics([...rows].reverse());
    expect(a).toEqual(b);
  });
});

describe("hostile and awkward input", () => {
  it("parses numerics that arrive as strings", () => {
    // Postgres `numeric` comes over PostgREST as a string. Left unparsed it
    // sorts lexically, "9" > "10", which looks like bad data, not bad code.
    const merged = mergeMetrics([row("oura", "2026-07-04", "sleep_minutes", "431")]);
    expect(merged[0].points[0].value).toBe(431);
    expect(typeof merged[0].points[0].value).toBe("number");
  });

  it("drops unparseable values instead of charting NaN", () => {
    const merged = mergeMetrics([
      row("oura", "2026-07-04", "sleep_minutes", "not-a-number"),
      row("oura", "2026-07-05", "sleep_minutes", 431),
    ]);
    expect(merged[0].points).toHaveLength(1);
    expect(merged[0].points[0].date).toBe("2026-07-05");
  });

  it("ignores metrics outside the vocabulary", () => {
    expect(mergeMetrics([row("oura", "2026-07-04", "blood_pressure", 120)])).toEqual([]);
  });

  it("uses an unranked provider rather than discarding it", () => {
    // A provider added to the adapters but forgotten in SOURCE_RANK should
    // degrade to "used when it is the only source", never vanish.
    const merged = mergeMetrics([row("newdevice", "2026-07-04", "steps", 5_000)]);
    expect(merged[0].points[0]).toMatchObject({ value: 5_000, source: "newdevice" });
  });

  it("still lets a ranked provider beat an unranked one", () => {
    const merged = mergeMetrics([
      row("newdevice", "2026-07-04", "steps", 5_000),
      row("garmin", "2026-07-04", "steps", 9_240),
    ]);
    expect(merged[0].points[0].source).toBe("garmin");
  });

  it("returns nothing for nothing", () => {
    expect(mergeMetrics([])).toEqual([]);
  });
});

describe("the ranking table itself", () => {
  it("covers every metric in the vocabulary", () => {
    // A metric with no ranking would silently fall through to "unknown", making
    // source choice arbitrary for it.
    for (const k of METRIC_KEYS) {
      expect(SOURCE_RANK[k], k).toBeTruthy();
      expect(SOURCE_RANK[k].length, k).toBeGreaterThan(0);
    }
  });

  it("ranks every provider, with no duplicates", () => {
    for (const k of METRIC_KEYS) {
      const list = SOURCE_RANK[k];
      expect(new Set(list).size, k).toBe(list.length);
      for (const p of PROVIDER_IDS) expect(list, `${k} is missing ${p}`).toContain(p);
    }
  });
});

describe("feeding the momentum model", () => {
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  it("converts merged sleep minutes into hours", () => {
    const merged = mergeMetrics([
      row("oura", today, "sleep_minutes", 420),
      row("oura", daysAgo(1), "sleep_minutes", 480),
    ]);
    expect(measuredSleepHours(merged, 30)).toBe(7.5);
  });

  it("returns null when no device has reported, leaving self-report alone", () => {
    // Everyone without a wearable must keep the existing behaviour exactly.
    expect(measuredSleepHours([], 30)).toBeNull();
    expect(measuredSleepHours(mergeMetrics([row("oura", today, "steps", 900)]), 30)).toBeNull();
  });

  it("ignores days outside the window", () => {
    const merged = mergeMetrics([
      row("oura", today, "sleep_minutes", 420),
      row("oura", daysAgo(90), "sleep_minutes", 60),
    ]);
    expect(measuredSleepHours(merged, 30)).toBe(7);
  });

  it("averages only what exists", () => {
    const merged = mergeMetrics([row("oura", today, "steps", 9_000)]);
    expect(recentAverage(merged[0], 30)).toBe(9_000);
    expect(recentAverage(undefined, 30)).toBeNull();
  });
});

describe("naming whose number it is", () => {
  it("tags a vendor composite with the vendor", () => {
    // "Metabolic score" reads like a fact about the body. It is not: it is one
    // company's formula, and the label has to say so.
    const merged = mergeMetrics([row("ultrahuman", "2026-07-04", "metabolic_score", 72)]);
    expect(merged[0].label).toBe("Metabolic score (Ultrahuman)");
  });

  it("leaves real quantities unqualified", () => {
    // Steps are steps whoever counted them. Tagging every series would make
    // the tag noise, and noise is not read.
    const merged = mergeMetrics([row("oura", "2026-07-04", "steps", 9_000)]);
    expect(merged[0].label).toBe("Steps");
  });

  it("drops the tag rather than crediting one vendor for two", () => {
    // Cannot happen today, the ranking picks one source per day. If it ever
    // did, one name on a mixed series would be worse than no name.
    const merged = mergeMetrics([
      row("ultrahuman", "2026-07-04", "metabolic_score", 72),
      row("oura", "2026-07-05", "metabolic_score", 64),
    ]);
    expect(merged[0].sources).toHaveLength(2);
    expect(merged[0].label).toBe("Metabolic score");
  });

  it("keeps the display names identical to the ones in Settings", () => {
    // Two spellings of the same device is a user with no way to tell they are
    // the same device.
    for (const id of PROVIDER_IDS) {
      expect(PROVIDERS[id].name).toBe(PROVIDER_NAMES[id]);
    }
  });
});
