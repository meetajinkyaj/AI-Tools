import { describe, expect, it } from "vitest";

import { POINTS } from "@/lib/points";
import { momentumSentence } from "./future-view";

const join = (p: ReturnType<typeof momentumSentence>) =>
  `${p.lead}${p.muted}${p.figure ? ` ${p.figure}` : ""}${p.tail}`;

describe("momentumSentence", () => {
  const base = { checkedInToday: false, checkinsThisMonth: 26, changeThisMonth: 4 };

  it("says what today is worth and where momentum goes with it", () => {
    const p = momentumSentence(72, { ...base, projectedIfCheckedIn: 76 }, "2026-11-20");
    expect(join(p)).toBe(
      `Today is worth +${POINTS.checkin} iki. Check in and log training and momentum climbs to 76, ahead of your November panel.`,
    );
    expect(p.figure).toBe("76");
  });

  it("never claims a climb that the projection does not show", () => {
    const p = momentumSentence(100, { ...base, projectedIfCheckedIn: 100 }, null);
    expect(p.figure).toBeNull();
    expect(join(p)).not.toContain("climbs");
  });

  it("switches to where momentum stands once today is in", () => {
    const p = momentumSentence(75, { ...base, checkedInToday: true, projectedIfCheckedIn: null }, "2026-11-20");
    expect(join(p)).toBe("Today is in. Momentum is at 75, heading into your November panel.");
  });

  it("uses no em or en dashes (house style)", () => {
    const p = momentumSentence(72, { ...base, projectedIfCheckedIn: 76 }, "2026-11-20");
    expect(join(p)).not.toMatch(/[–—]/);
  });
});
