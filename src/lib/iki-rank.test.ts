import { describe, expect, it } from "vitest";

import {
  RANKS,
  rankFor,
  rankProgress,
  rankUpCrossed,
  visibleRanks,
} from "./iki-rank";

describe("the ladder", () => {
  it("is the five named tiers, in order", () => {
    expect(RANKS.map((r) => r.id)).toEqual([
      "rookie",
      "apprentice",
      "pro",
      "sensei",
      "grandmaster",
    ]);
  });

  it("has strictly increasing thresholds starting at zero", () => {
    expect(RANKS[0].threshold).toBe(0);
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].threshold, RANKS[i].id).toBeGreaterThan(RANKS[i - 1].threshold);
    }
  });

  it("marks exactly one rank secret, and it is the top one", () => {
    const secret = RANKS.filter((r) => r.secret);
    expect(secret).toHaveLength(1);
    expect(secret[0].id).toBe(RANKS[RANKS.length - 1].id);
  });
});

describe("rankFor", () => {
  it("places a score in the right band, on the boundary too", () => {
    expect(rankFor(0).id).toBe("rookie");
    expect(rankFor(399).id).toBe("rookie");
    expect(rankFor(400).id).toBe("apprentice");
    expect(rankFor(1_999).id).toBe("apprentice");
    expect(rankFor(2_000).id).toBe("pro");
    expect(rankFor(8_000).id).toBe("sensei");
    expect(rankFor(25_000).id).toBe("grandmaster");
    expect(rankFor(999_999).id).toBe("grandmaster");
  });

  it("never throws on nonsense, and never over-promotes", () => {
    for (const bad of [NaN, -1, -Infinity, Infinity]) {
      const r = rankFor(bad as number);
      expect(r.id === "rookie" || r.id === "grandmaster").toBe(true);
    }
    expect(rankFor(NaN).id).toBe("rookie");
    expect(rankFor(-500).id).toBe("rookie");
  });
});

describe("the secret rank stays secret", () => {
  it("is hidden from the ladder until reached", () => {
    expect(visibleRanks(0).some((r) => r.id === "grandmaster")).toBe(false);
    expect(visibleRanks(24_999).some((r) => r.id === "grandmaster")).toBe(false);
    expect(visibleRanks(25_000).some((r) => r.id === "grandmaster")).toBe(true);
  });

  it("is NOT named by the next-rank line either", () => {
    // The bug this caught: `next` returned the secret rank, so the badge said
    // "15,800 to Iki Grandmaster" — revealing the name AND the exact threshold
    // to precisely the people it is meant to surprise.
    const p = rankProgress(9_200);
    expect(p.rank.id).toBe("sensei");
    expect(p.next).toBeNull();
    expect(p.nextIsSecret).toBe(true);
    expect(p.remaining).toBe(0);
  });

  it("distinguishes 'nothing above' from 'something withheld'", () => {
    expect(rankProgress(30_000).nextIsSecret).toBe(false);
    expect(rankProgress(30_000).next).toBeNull();
    expect(rankProgress(9_000).nextIsSecret).toBe(true);
  });
});

describe("rankProgress", () => {
  it("reports the distance to the next visible rank", () => {
    const p = rankProgress(500);
    expect(p.rank.id).toBe("apprentice");
    expect(p.next?.id).toBe("pro");
    expect(p.remaining).toBe(1_500);
  });

  it("keeps the bar fraction inside 0–1 at every score", () => {
    for (const s of [0, 1, 399, 400, 2_000, 7_999, 8_000, 25_000, 1e9, NaN, -10]) {
      const f = rankProgress(s as number).fraction;
      expect(f, String(s)).toBeGreaterThanOrEqual(0);
      expect(f, String(s)).toBeLessThanOrEqual(1);
      expect(Number.isFinite(f), String(s)).toBe(true);
    }
  });

  it("is empty-but-valid at the very start", () => {
    const p = rankProgress(0);
    expect(p.rank.id).toBe("rookie");
    expect(p.fraction).toBe(0);
    expect(p.remaining).toBe(400);
  });
});

describe("rankUpCrossed", () => {
  it("fires only when a boundary is actually crossed", () => {
    expect(rankUpCrossed(399, 409)?.id).toBe("apprentice");
    expect(rankUpCrossed(410, 420)).toBeNull();
    expect(rankUpCrossed(0, 0)).toBeNull();
  });

  it("reports the FINAL rank when several are crossed at once", () => {
    // A big outcome bonus can leap a band; the celebration should name where
    // they landed, not the first line they stepped over.
    expect(rankUpCrossed(0, 9_000)?.id).toBe("sensei");
  });

  it("never fires backwards", () => {
    // iki_score is monotonic, but if it ever regressed this must stay quiet
    // rather than congratulate someone on a demotion.
    expect(rankUpCrossed(9_000, 100)?.id).toBe("rookie");
    expect(rankUpCrossed(9_000, 9_000)).toBeNull();
  });
});
