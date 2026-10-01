import { describe, expect, it } from "vitest";

import { GOAL_PILLAR, memberSince } from "./profile-view";

describe("profile identity chips", () => {
  it("writes the member-since month out", () => {
    expect(memberSince("2025-11-03T09:00:00Z")).toBe("Nov 2025");
  });
  it("leaves the chip out for an unreadable date", () => {
    expect(memberSince("not a date")).toBe("");
  });
  it("gives every primary goal a pillar hue", () => {
    expect(GOAL_PILLAR.longevity).toBe("longevity");
    expect(GOAL_PILLAR.hrv).toBe("recovery");
    expect(GOAL_PILLAR.muscle_gain).toBe("performance");
  });
});
