import { describe, expect, it } from "vitest";

import { markerLabel } from "./trends-view";

/**
 * The reward line on Trends.
 *
 * This is the payoff of the entire loop: somebody changed something, the next
 * panel proved it, and the app says so. It was printing VISCERAL_FAT, which is
 * the database's name for the marker shouted at the member. `/api/trends` now
 * resolves the catalog's display name; this is the half that decides what to do
 * when it cannot.
 */

describe("markerLabel", () => {
  it("uses the catalog name when there is one", () => {
    expect(markerLabel({ marker_key: "visceral_fat", marker_name: "Visceral fat" })).toBe(
      "Visceral fat",
    );
  });

  it("never shouts the column name", () => {
    expect(markerLabel({ marker_key: "visceral_fat", marker_name: null })).toBe("Visceral fat");
  });

  it("keeps a marker that has fallen out of the catalog readable", () => {
    // Better a plain fallback than hiding a reward the member has earned.
    expect(markerLabel({ marker_key: "apo_b", marker_name: null })).toBe("Apo b");
  });

  it("has something to say about an empty key", () => {
    expect(markerLabel({ marker_key: "", marker_name: null })).toBe("A marker");
  });
});
