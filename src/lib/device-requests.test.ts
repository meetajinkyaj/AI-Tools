import { describe, expect, it } from "vitest";

import {
  isUnrecognised,
  matchDevice,
  normalize,
  SUGGESTION_HINTS,
  tallyRequests,
  type RequestRow,
} from "./device-requests";

/**
 * The whole value of a suggestion box is the count. These tests pin the two
 * ways a count goes wrong: the same device splitting across spellings, and two
 * different devices being merged into one.
 */

describe("folding what people type", () => {
  it("treats case, punctuation and spacing as the same device", () => {
    const keys = ["oura", "Oura", "OURA RING", "oura-ring", "Oura Ring®", "  oura   ring  "].map(
      (s) => matchDevice(s)?.key,
    );
    expect(new Set(keys)).toEqual(new Set(["oura"]));
  });

  it("folds model numbers onto the device", () => {
    // Nobody deciding which vendor to chase cares about Gen 3 versus Gen 4.
    for (const s of ["oura ring 4", "oura gen 3", "Oura Ring 3"]) {
      expect(matchDevice(s)?.key, s).toBe("oura");
    }
  });

  it("pulls the device out of a sentence", () => {
    expect(matchDevice("please add whoop")?.key).toBe("whoop");
    expect(matchDevice("I use a Garmin Fenix")?.key).toBe("garmin");
  });

  it("does not match a device name inside an unrelated word", () => {
    // "polar" inside "polarised" is not a request for a Polar watch.
    expect(matchDevice("polarised sunglasses")?.key).toBe("other:polarised sunglasses");
  });
});

describe("merges that would corrupt the tally", () => {
  it("keeps Apple Watch separate from Apple Health", () => {
    // Both contain "apple". Folding them loses the difference between "I own
    // this hardware" and "integrate this platform".
    expect(matchDevice("apple watch")?.key).toBe("apple_watch");
    expect(matchDevice("apple health")?.key).toBe("apple_health");
  });

  it("keeps the Galaxy Ring separate from Samsung Health", () => {
    // "samsung" alone maps to Samsung Health, so the longer alias has to win.
    expect(matchDevice("samsung galaxy ring")?.key).toBe("samsung_galaxy_ring");
    expect(matchDevice("galaxy ring")?.key).toBe("samsung_galaxy_ring");
    expect(matchDevice("samsung health")?.key).toBe("samsung_health");
  });

  it("routes every Fittr spelling to one bucket", () => {
    // The device that prompted this feature, and the one people will spell
    // most inconsistently.
    for (const s of ["fittr", "Fittr HART", "hart ring", "FITTR hart ring", "fitr hart"]) {
      expect(matchDevice(s)?.key, s).toBe("fittr_hart");
    }
  });

  it("carries why a device is blocked, so admin can answer the question", () => {
    const m = matchDevice("fittr hart")!;
    expect(m.blocked).toBe(true);
    expect(m.reason).toMatch(/no public api/i);
  });
});

describe("input we did not anticipate", () => {
  it("keeps an unknown device rather than dropping it", () => {
    // The long tail is the point of a free-text box.
    const m = matchDevice("Kairos Vitals Band")!;
    expect(isUnrecognised(m.key)).toBe(true);
    expect(m.label).toBe("Kairos Vitals Band");
  });

  it("folds a vendor's companion app onto the vendor", () => {
    // Zepp is Amazfit's app; someone naming either means the same integration.
    expect(matchDevice("Zepp")?.key).toBe("amazfit");
    expect(matchDevice("Amazfit Helio Ring")?.key).toBe("amazfit");
  });

  it("lands two people typing the same unknown device in one bucket", () => {
    expect(matchDevice("acme tracker")?.key).toBe(matchDevice("ACME  Tracker!")?.key);
  });

  it("rejects input too short to be a device", () => {
    expect(matchDevice("")).toBeNull();
    expect(matchDevice("   ")).toBeNull();
    expect(matchDevice("a")).toBeNull();
    expect(matchDevice("!!!")).toBeNull();
  });

  it("truncates an essay instead of storing it", () => {
    const m = matchDevice("x".repeat(500))!;
    expect(m.key.length).toBeLessThanOrEqual("other:".length + 60);
  });

  it("normalises accents and symbols without emptying the string", () => {
    expect(normalize("Ōura—Ring")).toBe("oura ring");
  });
});

describe("the tally the admin dashboard reads", () => {
  const row = (
    device_key: string,
    raw_text: string,
    notify = false,
    created_at = "2026-07-01T00:00:00Z",
  ): RequestRow => ({ device_key, raw_text, notify, created_at });

  it("ranks by how many people asked", () => {
    const t = tallyRequests([
      row("oura", "Oura"),
      row("fittr_hart", "Fittr HART"),
      row("fittr_hart", "hart ring"),
      row("fittr_hart", "fittr"),
      row("apple_watch", "apple watch"),
      row("apple_watch", "iwatch"),
    ]);
    expect(t.map((d) => [d.label, d.count])).toEqual([
      ["Fittr HART", 3],
      ["Apple Watch", 2],
      ["Oura Ring", 1],
    ]);
  });

  it("counts the follow-up opt-ins separately", () => {
    // This is the size of the mailing list on launch day, not the demand.
    const t = tallyRequests([
      row("oura", "oura", true),
      row("oura", "oura", false),
      row("oura", "oura", true),
    ]);
    expect(t[0]).toMatchObject({ count: 3, notifyCount: 2 });
  });

  it("breaks ties toward the more recent request", () => {
    const t = tallyRequests([
      row("polar", "polar", false, "2026-07-01T00:00:00Z"),
      row("coros", "coros", false, "2026-07-20T00:00:00Z"),
    ]);
    expect(t.map((d) => d.key)).toEqual(["coros", "polar"]);
  });

  it("labels an unrecognised device from what was typed", () => {
    const t = tallyRequests([row("other:acme tracker", "ACME Tracker")]);
    expect(t[0]).toMatchObject({ label: "ACME Tracker", unrecognised: true });
  });

  it("flags devices we already support, since those are a discoverability bug", () => {
    const t = tallyRequests([row("oura", "oura")]);
    expect(t[0].supported).toBe(true);
  });

  it("returns nothing for nothing", () => {
    expect(tallyRequests([])).toEqual([]);
  });
});

describe("the autocomplete hints", () => {
  it("never suggests a device we already integrate", () => {
    // Being prompted to request Oura when Oura is in the list above is absurd.
    for (const supported of ["Oura Ring", "Fitbit", "Whoop", "Garmin", "Withings", "Ultrahuman"]) {
      expect(SUGGESTION_HINTS).not.toContain(supported);
    }
  });

  it("offers names the matcher actually recognises", () => {
    // A hint that does not round-trip would teach users a spelling we then fail
    // to fold — worse than offering no hint at all.
    for (const hint of SUGGESTION_HINTS) {
      const m = matchDevice(hint);
      expect(m, hint).not.toBeNull();
      expect(isUnrecognised(m!.key), hint).toBe(false);
    }
  });
});
