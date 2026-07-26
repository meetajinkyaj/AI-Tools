import { describe, expect, it } from "vitest";

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  coverRect,
  fitFontSize,
  shareCardCopy,
  shareFileName,
  type ShareCardInput,
} from "./share-card";

const base: ShareCardInput = {
  streak: 12,
  pointsEarned: 10,
  trainingLogged: true,
  activities: ["Running"],
  date: new Date("2026-07-26T10:00:00Z"),
};

describe("shareCardCopy", () => {
  it("leads with the streak", () => {
    const copy = shareCardCopy(base);
    expect(copy.headline).toBe("12");
    expect(copy.headlineLabel).toBe("day streak");
  });

  it("names up to two activities, then summarises", () => {
    expect(shareCardCopy({ ...base, activities: ["Running"] }).activityLine).toBe(
      "Running",
    );
    expect(
      shareCardCopy({ ...base, activities: ["Running", "Gym"] }).activityLine,
    ).toBe("Running · Gym");
    // Three or more would overflow the card, so the tail is counted instead.
    expect(
      shareCardCopy({ ...base, activities: ["Running", "Gym", "Yoga", "Boxing"] })
        .activityLine,
    ).toBe("Running · Gym +2");
  });

  it("still says something when training was logged without a type", () => {
    expect(
      shareCardCopy({ ...base, activities: [] }).activityLine,
    ).toBe("Trained today");
  });

  it("says nothing about training on a rest day", () => {
    const copy = shareCardCopy({ ...base, trainingLogged: false, activities: [] });
    expect(copy.activityLine).toBe("");
  });

  it("omits the points line when nothing was earned", () => {
    expect(shareCardCopy({ ...base, pointsEarned: 10 }).pointsLine).toBe("+10 iki");
    // Re-saving an existing check-in earns nothing; don't advertise "+0".
    expect(shareCardCopy({ ...base, pointsEarned: 0 }).pointsLine).toBe("");
  });

  it("never renders a negative or fractional streak", () => {
    expect(shareCardCopy({ ...base, streak: -3 }).headline).toBe("0");
    expect(shareCardCopy({ ...base, streak: 7.9 }).headline).toBe("7");
  });

  it("carries the app link, which is the whole point of sharing", () => {
    expect(shareCardCopy(base).footer).toBe("app.ikigaro.com");
  });

  it("formats the date unambiguously", () => {
    expect(shareCardCopy(base).dateLine).toBe("26 July 2026");
  });
});

describe("shareFileName", () => {
  it("sorts chronologically and zero-pads", () => {
    expect(shareFileName(new Date(2026, 6, 5))).toBe("ikigaro-check-in-2026-07-05.png");
  });
});

describe("coverRect", () => {
  it("crops the sides of a landscape photo", () => {
    // 4000x3000 into 1080x1350 (portrait box): full height, narrower slice.
    const r = coverRect(4000, 3000, CARD_WIDTH, CARD_HEIGHT);
    expect(r.sh).toBe(3000);
    expect(r.sw).toBeCloseTo(3000 * (CARD_WIDTH / CARD_HEIGHT), 5);
    expect(r.sx).toBeCloseTo((4000 - r.sw) / 2, 5); // centred
    expect(r.sy).toBe(0);
  });

  it("crops top and bottom of a very tall photo", () => {
    // 1080x1920 phone photo is taller than 4:5.
    const r = coverRect(1080, 1920, CARD_WIDTH, CARD_HEIGHT);
    expect(r.sw).toBe(1080);
    expect(r.sh).toBeCloseTo(1080 / (CARD_WIDTH / CARD_HEIGHT), 5);
    expect(r.sy).toBeCloseTo((1920 - r.sh) / 2, 5);
    expect(r.sx).toBe(0);
  });

  it("uses the whole image when aspect ratios already match", () => {
    const r = coverRect(CARD_WIDTH, CARD_HEIGHT, CARD_WIDTH, CARD_HEIGHT);
    expect(r).toEqual({ sx: 0, sy: 0, sw: CARD_WIDTH, sh: CARD_HEIGHT });
  });

  it("never returns a crop larger than the source", () => {
    for (const [w, h] of [
      [100, 4000],
      [4000, 100],
      [1, 1],
      [3024, 4032],
    ]) {
      const r = coverRect(w, h, CARD_WIDTH, CARD_HEIGHT);
      expect(r.sw).toBeLessThanOrEqual(w);
      expect(r.sh).toBeLessThanOrEqual(h);
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
    }
  });

  it("degrades safely on a zero-sized image", () => {
    expect(coverRect(0, 0, CARD_WIDTH, CARD_HEIGHT)).toEqual({
      sx: 0,
      sy: 0,
      sw: 0,
      sh: 0,
    });
  });
});

describe("fitFontSize", () => {
  // Stand-in for canvas text metrics: width grows linearly with size.
  const measure = (charCount: number) => (size: number) => size * 0.55 * charCount;

  it("keeps the maximum size when the text already fits", () => {
    expect(fitFontSize(measure(2), 888, 340)).toBe(340);
  });

  it("shrinks a long streak so it cannot run off the card", () => {
    // "365" at 340px would be ~561px — fine. Force a narrow box instead.
    const size = fitFontSize(measure(3), 300, 340);
    expect(size).toBeLessThan(340);
    expect(measure(3)(size)).toBeLessThanOrEqual(300);
  });

  it("never returns less than the floor, even in an impossible box", () => {
    expect(fitFontSize(measure(50), 10, 340, 16)).toBe(16);
  });

  it("is monotonic — a wider box never yields a smaller size", () => {
    const narrow = fitFontSize(measure(3), 300, 340);
    const wide = fitFontSize(measure(3), 900, 340);
    expect(wide).toBeGreaterThanOrEqual(narrow);
  });
});
