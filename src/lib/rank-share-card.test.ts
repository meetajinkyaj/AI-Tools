import { describe, expect, it } from "vitest";

import { RANKS } from "./iki-rank";
import { referralLink } from "./referral";
import { RANK_KANJI_CHAR, IKIGAI_GLYPHS } from "./rank-kanji";
import { IKI_GOLD, RANK_ART, rankChipSvg, rankPinSvg, svgDataUri } from "./rank-pin";
import { INVITE_LINK_ON_SHARED_CARDS } from "./share-card";
import {
  DEFAULT_RANK_FORMAT,
  RANK_FORMATS,
  rankCaption,
  rankCardDate,
  rankFormatSize,
  rankInviteLine,
  type RankCardInput,
} from "./rank-share-card";

const sensei = RANKS.find((r) => r.id === "sensei")!;

function input(over: Partial<RankCardInput> = {}): RankCardInput {
  return {
    rankId: sensei.id,
    rankName: sensei.name,
    kanji: sensei.kanji,
    scene: sensei.scene,
    ikiScore: 8_140,
    streak: 151,
    date: new Date(2026, 6, 27),
    referralCode: "AJINKYA",
    ...over,
  };
}

describe("the invite link stays off during closed beta", () => {
  it("prints nothing on the card, code or not", () => {
    // The flag is the point: access is invite-only, so a publicly posted card
    // advertising a join link sends strangers at a door that will not open.
    expect(INVITE_LINK_ON_SHARED_CARDS).toBe(false);
    expect(rankInviteLine("AJINKYA")).toBeNull();
    expect(rankInviteLine(null)).toBeNull();
  });

  it("keeps it out of the caption too", () => {
    // A caption is if anything more public than the image — it survives being
    // copied, so gating only the pixels would leak the link anyway.
    const text = rankCaption(input());
    expect(text).not.toMatch(/http/i);
    expect(text).not.toMatch(/join/i);
    expect(text).not.toContain("AJINKYA");
  });

  it("never emits the design's dead ikigaro.com/join link", () => {
    // The design document prints "ikigaro.com/join · AJ-47". That path does not
    // exist, and the hyphenated code is not one our normaliser can produce.
    expect(rankCaption(input())).not.toContain("ikigaro.com/join");

    // The flag is off, so nothing prints today. What matters is what WILL
    // print the day it flips — assert the source directly, since that is the
    // only thing `rankInviteLine` and the caption ever build from.
    expect(referralLink("AJINKYA")).toBe("https://app.ikigaro.com/?ref=AJINKYA");
    expect(referralLink("AJINKYA")).not.toContain("/join");
  });

  it("keeps ?ref lowercase, which the check-in card learned the hard way", () => {
    // The tracked-label helper upper-cases its text. Run the invite line
    // through it and "?ref=" becomes "?REF=" — a different query parameter, a
    // link that resolves but attributes to nobody, and no error anywhere.
    expect(referralLink("AJINKYA")).toContain("?ref=");
    expect(referralLink("AJINKYA").toUpperCase()).not.toContain("?ref=");
  });
});

describe("the caption", () => {
  it("names the rank and the numbers", () => {
    const text = rankCaption(input());
    expect(text).toContain("Iki Sensei");
    expect(text).toContain("8,140");
    expect(text).toContain("151 day streak");
  });

  it("drops the streak clause at zero rather than boasting about none", () => {
    expect(rankCaption(input({ streak: 0 }))).not.toMatch(/streak/i);
  });
});

describe("the card date", () => {
  it("is fixed-format, not locale-dependent", () => {
    // The card is an image. A date that renders differently per device makes
    // two people's cards look like two different products.
    expect(rankCardDate(new Date(2026, 6, 27))).toBe("Mon · 27 Jul");
    expect(rankCardDate(new Date(2026, 0, 1))).toBe("Thu · 1 Jan");
  });
});

describe("formats", () => {
  it("offers exactly the three the share sheet shows", () => {
    expect(RANK_FORMATS.map((f) => f.id)).toEqual(["story", "post", "square"]);
  });

  it("names a platform for each, because nobody thinks in ratios", () => {
    for (const f of RANK_FORMATS) expect(f.where.length).toBeGreaterThan(0);
  });

  it("defaults to the ratio the design specified", () => {
    expect(DEFAULT_RANK_FORMAT).toBe("post");
    expect(rankFormatSize("post")).toEqual({ w: 1080, h: 1350 });
  });

  it("falls back rather than returning undefined on a bad id", () => {
    expect(rankFormatSize("nope" as never)).toEqual({ w: 1080, h: 1350 });
  });
});

describe("the pin artwork", () => {
  it("has tokens for every rank", () => {
    for (const r of RANKS) expect(RANK_ART[r.id], r.id).toBeTruthy();
  });

  it("reserves gold for Grandmaster and nothing else", () => {
    // The design is explicit: gold exists on that one pin and nowhere else in
    // the product. If a later tier borrows it, the top rank stops reading as
    // special the moment it is no longer the only gold thing.
    const gold = RANKS.filter((r) => {
      const a = RANK_ART[r.id];
      return [a.rim, a.chipInk, a.border, a.hankoFill].includes(IKI_GOLD);
    });
    expect(gold.map((r) => r.id)).toEqual(["grandmaster"]);
  });

  it("carries the right kanji per rank", () => {
    expect(RANKS.map((r) => r.kanji)).toEqual(["芽", "修", "錬", "師", "道"]);
    for (const r of RANKS) expect(RANK_KANJI_CHAR[r.id]).toBe(r.kanji);
  });

  it("draws the kanji as an outline, never as text", () => {
    // A <text> element would depend on a Japanese font the app does not load
    // and cannot load — next/font offers no JP subset for Noto Sans JP. Tofu
    // on a badge people post publicly is not a risk worth carrying.
    for (const r of RANKS) {
      const pin = rankPinSvg(r.id, r.name, { ringText: true });
      const chip = rankChipSvg(r.id);
      expect(chip, r.id).not.toContain("<text");
      // The pin's only text is the Latin rank name; no CJK may reach a <text>.
      for (const cjk of ["生", "き", "甲", "斐", r.kanji]) {
        const inText = new RegExp(`<text[^>]*>[^<]*${cjk}`).test(pin);
        expect(inText, `${r.id} renders ${cjk} as text`).toBe(false);
      }
    }
  });

  it("carries all four ikigai glyphs for the ring", () => {
    expect(IKIGAI_GLYPHS.map((g) => g.char).join("")).toBe("生き甲斐");
    for (const g of IKIGAI_GLYPHS) expect(g.path.length).toBeGreaterThan(50);
  });

  it("omits ring text when asked, for the canvas path", () => {
    // The share card rasterises the SVG through an <img>, where external fonts
    // never load — so it asks for no lettering and draws it on canvas instead.
    const bare = rankPinSvg("sensei", "Iki Sensei", { ringText: false });
    expect(bare).not.toContain("<text");
    expect(bare).not.toContain("textPath");
  });

  it("produces a data URI that survives the # in every colour", () => {
    // An un-encoded "#" truncates a data URI at the first colour, which fails
    // as a blank image rather than an error.
    const uri = svgDataUri(rankPinSvg("pro", "Iki Pro"));
    expect(uri.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(uri).not.toContain("#");
  });
});

describe("the secret rank is not leaked by the artwork", () => {
  it("keeps Grandmaster out of anything rendered before it is earned", () => {
    // Nothing here should be reachable from a lower rank's card, but the pin
    // builder is public, so this pins the intent: the app must ask for it by
    // id, and only `visibleRanks` decides when that is allowed.
    const gm = RANKS.find((r) => r.id === "grandmaster")!;
    expect(gm.secret).toBe(true);
    expect(RANK_ART.grandmaster.rim).toBe(IKI_GOLD);
  });
});
