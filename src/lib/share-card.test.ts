import { describe, expect, it } from "vitest";

import { referralLink } from "./referral";
import {
  activityLabel,
  coverRect,
  DEFAULT_FIELDS,
  energyLabel,
  fitFontSize,
  FORMATS,
  formatSize,
  INVITE_LINK_ON_SHARED_CARDS,
  inviteLine,
  shareCaption,
  shareFileName,
  shortDate,
  sleepLabel,
  statTiles,
  weekStrip,
  type ShareCardInput,
} from "./share-card";

const base: ShareCardInput = {
  streak: 12,
  pointsBalance: 240,
  pointsEarned: 10,
  trainingLogged: true,
  activities: ["Running"],
  exerciseTypes: ["running"],
  energy: 4,
  sleepHours: 7.5,
  inviteCode: "AJINKYA",
  date: new Date("2026-07-26T10:00:00Z"),
};

describe("activityLabel", () => {
  it("names up to two activities, then counts the rest", () => {
    expect(activityLabel(["Running"], true)).toBe("Running");
    expect(activityLabel(["Running", "Gym"], true)).toBe("Running · Gym");
    expect(activityLabel(["Running", "Gym", "Yoga", "Boxing"], true)).toBe(
      "Running · Gym +2",
    );
  });

  it("still says something when training was logged without a type", () => {
    expect(activityLabel([], true)).toBe("Trained");
  });

  it("calls a rest day a rest day", () => {
    expect(activityLabel([], false)).toBe("Rest day");
  });
});

describe("labels", () => {
  it("formats energy out of five", () => {
    expect(energyLabel(4)).toBe("4 of 5");
    expect(energyLabel(null)).toBe("—");
  });

  it("drops the decimal on whole hours", () => {
    expect(sleepLabel(7)).toBe("7h");
    expect(sleepLabel(7.5)).toBe("7.5h");
    expect(sleepLabel(7.46)).toBe("7.5h");
    expect(sleepLabel(null)).toBe("—");
  });

  it("formats the masthead date as the design specifies", () => {
    expect(shortDate(new Date("2026-07-26T10:00:00Z"))).toBe("Sun · 26 Jul");
  });

  it("carries no invite link while the beta is closed", () => {
    // Access is invite-only, so a card advertising a join link would point
    // strangers at a door that does not open. Empty means "draw nothing".
    expect(INVITE_LINK_ON_SHARED_CARDS).toBe(false);
    expect(inviteLine("AJINKYA")).toBe("");
    expect(inviteLine("")).toBe("");
  });
});

/**
 * The link is switched off for the closed beta, not removed. These pin the
 * behaviour it must return to, so flipping INVITE_LINK_ON_SHARED_CARDS back to
 * true is a verified one-line change rather than a hope. They reproduce the
 * enabled formatting from the same `referralLink()` the card would use.
 */
describe("the invite link, for when the beta opens", () => {
  const enabledLine = (code: string) =>
    code ? referralLink(code).slice("https://".length) : "app.ikigaro.com";

  it("is the SAME link the app hands out — not an invented one", () => {
    // This shipped as `ikigaro.com/join · CODE`, which 404s. Anyone who typed
    // it in landed nowhere and the referral never attributed, so the growth
    // loop the card exists for was silently broken.
    expect(`https://${enabledLine("AJINKYA")}`).toBe(referralLink("AJINKYA"));
    expect(enabledLine("AJINKYA")).toBe("app.ikigaro.com/?ref=AJINKYA");
  });

  it("keeps the query parameter lowercase", () => {
    // The renderer uppercases every other tracked label on the card. Doing it
    // to this one turns `?ref=` into `?REF=` — a different parameter, so
    // attribution fails while the card still looks correct.
    expect(enabledLine("AJINKYA")).toContain("?ref=");
    expect(enabledLine("AJINKYA")).not.toContain("?REF=");
  });

  it("still resolves to something usable without a code", () => {
    expect(enabledLine("")).toBe("app.ikigaro.com");
  });
});

describe("shareCaption", () => {
  it("carries no link at all while the beta is closed", () => {
    // The whole point of switching this off: a shared card must not hand a
    // stranger a way in. Assert on the URL shape, not just the code, so a
    // bare domain sneaking back in also fails.
    for (const input of [base, { ...base, inviteCode: "" }]) {
      const caption = shareCaption(input);
      expect(caption).not.toContain("ikigaro.com");
      expect(caption).not.toContain("http");
      expect(caption).not.toContain("ref=");
      expect(caption).not.toContain("AJINKYA");
    }
  });

  it("names the streak, and stays sane on day zero", () => {
    expect(shareCaption(base)).toContain("Day 12");
    expect(shareCaption({ ...base, streak: 0 })).not.toContain("Day 0");
  });

  it("never carries anything about the body", () => {
    // Same rule as the card itself: energy and sleep are not for a caption
    // that lands on a public timeline.
    const caption = shareCaption({ ...base, energy: 4, sleepHours: 7.5 });
    expect(caption).not.toMatch(/energy|sleep|\bhours?\b/i);
  });
});

describe("FORMATS", () => {
  it("names the platforms each ratio is for", () => {
    // Nobody thinks in aspect ratios; every option has to say where it goes.
    for (const f of FORMATS) {
      expect(f.where, f.id).toBeTruthy();
    }
    expect(FORMATS.find((f) => f.id === "story")?.where).toMatch(/instagram/i);
  });
});

describe("statTiles — the privacy surface", () => {
  it("defaults to habit data only: energy and sleep are OFF", () => {
    expect(DEFAULT_FIELDS.energy).toBe(false);
    expect(DEFAULT_FIELDS.sleep).toBe(false);

    const labels = statTiles(base, DEFAULT_FIELDS).map((t) => t.label);
    expect(labels).toEqual(["Trained", "Iki points"]);
    expect(labels).not.toContain("Energy");
    expect(labels).not.toContain("Sleep");
  });

  it("includes energy and sleep only when the user turns them on", () => {
    const labels = statTiles(base, {
      ...DEFAULT_FIELDS,
      energy: true,
      sleep: true,
    }).map((t) => t.label);
    expect(labels).toEqual(["Trained", "Iki points", "Energy", "Sleep"]);
  });

  it("omits a field the user enabled but never recorded", () => {
    const labels = statTiles(
      { ...base, energy: null, sleepHours: null },
      { ...DEFAULT_FIELDS, energy: true, sleep: true },
    ).map((t) => t.label);
    expect(labels).toEqual(["Trained", "Iki points"]);
  });

  it("shows today's earn as a subtitle, and hides it when nothing was earned", () => {
    expect(statTiles(base, DEFAULT_FIELDS)[1].sub).toBe("+10 today");
    expect(
      statTiles({ ...base, pointsEarned: 0 }, DEFAULT_FIELDS)[1].sub,
    ).toBeUndefined();
  });

  it("can be emptied entirely", () => {
    expect(
      statTiles(base, {
        streak: true,
        training: false,
        points: false,
        energy: false,
        sleep: false,
      }),
    ).toEqual([]);
  });
});

describe("weekStrip", () => {
  const today = new Date(2026, 6, 26); // Sunday

  it("returns seven days ending today", () => {
    const days = weekStrip(3, today);
    expect(days).toHaveLength(7);
    expect(days[6].isToday).toBe(true);
    expect(days.filter((d) => d.isToday)).toHaveLength(1);
  });

  it("fills exactly as many days as the streak proves", () => {
    expect(weekStrip(3, today).filter((d) => d.filled)).toHaveLength(3);
    expect(weekStrip(0, today).filter((d) => d.filled)).toHaveLength(0);
  });

  it("never fills more than seven, however long the streak", () => {
    expect(weekStrip(400, today).every((d) => d.filled)).toBe(true);
  });

  it("under-reports rather than over-reports", () => {
    // We have no per-day history, so a check-in before a broken streak shows
    // empty. Wrong in the safe direction for something about to be published.
    const days = weekStrip(2, today);
    expect(days.slice(0, 5).every((d) => !d.filled)).toBe(true);
    expect(days.slice(5).every((d) => d.filled)).toBe(true);
  });

  it("labels the last cell with today's weekday initial", () => {
    expect(weekStrip(1, today)[6].initial).toBe("S"); // Sunday
  });
});

describe("formats", () => {
  it("offers story, post and square at a 1080 width", () => {
    expect(formatSize("story")).toEqual({ w: 1080, h: 1920 });
    expect(formatSize("post")).toEqual({ w: 1080, h: 1350 });
    expect(formatSize("square")).toEqual({ w: 1080, h: 1080 });
  });
});

describe("shareFileName", () => {
  it("names the template and sorts chronologically", () => {
    expect(shareFileName(new Date(2026, 6, 5), "ledger")).toBe(
      "ikigaro-ledger-2026-07-05.png",
    );
  });
});

describe("coverRect", () => {
  it("crops the sides of a landscape photo", () => {
    const r = coverRect(4000, 3000, 1080, 1350);
    expect(r.sh).toBe(3000);
    expect(r.sw).toBeCloseTo(3000 * (1080 / 1350), 5);
    expect(r.sx).toBeCloseTo((4000 - r.sw) / 2, 5);
  });

  it("crops top and bottom of a tall phone photo", () => {
    const r = coverRect(1080, 1920, 1080, 1350);
    expect(r.sw).toBe(1080);
    expect(r.sy).toBeCloseTo((1920 - r.sh) / 2, 5);
  });

  it("never returns a crop larger than the source, at any format", () => {
    for (const [w, h] of [
      [100, 4000],
      [4000, 100],
      [3024, 4032],
    ]) {
      for (const fmt of [
        [1080, 1920],
        [1080, 1350],
        [1080, 1080],
      ]) {
        const r = coverRect(w, h, fmt[0], fmt[1]);
        expect(r.sw).toBeLessThanOrEqual(w);
        expect(r.sh).toBeLessThanOrEqual(h);
        expect(r.sx).toBeGreaterThanOrEqual(0);
        expect(r.sy).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("degrades safely on a zero-sized image", () => {
    expect(coverRect(0, 0, 1080, 1350)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe("fitFontSize", () => {
  const measure = (charCount: number) => (size: number) => size * 0.55 * charCount;

  it("keeps the maximum size when the text already fits", () => {
    expect(fitFontSize(measure(2), 888, 340)).toBe(340);
  });

  it("shrinks long text so it cannot run off the card", () => {
    const size = fitFontSize(measure(3), 300, 340);
    expect(size).toBeLessThan(340);
    expect(measure(3)(size)).toBeLessThanOrEqual(300);
  });

  it("never returns less than the floor", () => {
    expect(fitFontSize(measure(50), 10, 340, 16)).toBe(16);
  });

  it("is monotonic — a wider box never yields a smaller size", () => {
    expect(fitFontSize(measure(3), 900, 340)).toBeGreaterThanOrEqual(
      fitFontSize(measure(3), 300, 340),
    );
  });
});
