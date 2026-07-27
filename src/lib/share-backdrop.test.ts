import { describe, expect, it } from "vitest";

import { MOTIF_ADVANCE_EM, MOTIF_PATH, MOTIF_UNITS_PER_EM } from "./ikigai-motif";
import {
  BACKDROPS,
  backdropById,
  defaultBackdrop,
  GRADIENT_STOPS,
  gradientAxis,
  MOTIF_MIN_SIZE,
  motifOrigin,
  motifSize,
  vignette,
} from "./share-backdrop";

const FORMATS = [
  [1080, 1920], // story
  [1080, 1350], // post
  [1080, 1080], // square
] as const;

describe("the six pillars", () => {
  it("ships exactly the six the spec names", () => {
    expect(BACKDROPS.map((b) => b.id)).toEqual([
      "movement",
      "sauna",
      "ice",
      "stillness",
      "fuel",
      "sleep",
    ]);
  });

  it("gives every pillar three distinct stops", () => {
    for (const b of BACKDROPS) {
      expect(new Set([b.highlight, b.mid, b.base]).size, b.id).toBe(3);
      for (const hex of [b.highlight, b.mid, b.base]) {
        expect(hex, `${b.id} ${hex}`).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("darkens monotonically from highlight to base", () => {
    // The gradient reads as light falling top-left to bottom-right. If a mid
    // were lighter than its highlight the whole ramp would invert.
    const luma = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    for (const b of BACKDROPS) {
      expect(luma(b.highlight), b.id).toBeGreaterThan(luma(b.mid));
      expect(luma(b.mid), b.id).toBeGreaterThan(luma(b.base));
    }
  });

  it("keeps every motif subtle enough to stay a texture", () => {
    for (const b of BACKDROPS) {
      expect(b.motifOpacity, b.id).toBeGreaterThan(0);
      expect(b.motifOpacity, b.id).toBeLessThanOrEqual(0.5);
    }
  });

  it("falls back to a real backdrop for an unknown id", () => {
    expect(backdropById("movement").name).toBe("Movement");
    expect(backdropById("nope" as never)).toBe(BACKDROPS[0]);
  });
});

describe("geometry — normalised, so one spec serves every format", () => {
  it("re-slants the gradient axis per aspect ratio", () => {
    for (const [w, h] of FORMATS) {
      const a = gradientAxis(w, h);
      expect(a.x0).toBeCloseTo(0.18 * w, 6);
      expect(a.y0).toBe(0);
      expect(a.x1).toBeCloseTo(0.86 * w, 6);
      expect(a.y1).toBe(h);
    }
    // Same width, different height => a different slant, not a crop.
    expect(gradientAxis(1080, 1920).y1).not.toBe(gradientAxis(1080, 1080).y1);
  });

  it("uses three stops and only three", () => {
    // A fourth stop bands visibly on OLED at these values.
    expect(GRADIENT_STOPS).toEqual([0, 0.46, 1]);
  });

  it("scales the vignette off the longest edge", () => {
    for (const [w, h] of FORMATS) {
      const v = vignette(w, h);
      const maxEdge = Math.max(w, h);
      expect(v.cx).toBeCloseTo(0.5 * w, 6);
      expect(v.cy).toBeCloseTo(0.42 * h, 6);
      expect(v.inner).toBeCloseTo(0.3 * maxEdge, 6);
      expect(v.outer).toBeCloseTo(0.92 * maxEdge, 6);
      expect(v.outer).toBeGreaterThan(v.inner);
    }
  });

  it("sizes the motif off the width, with a floor for thumbnails", () => {
    expect(motifSize(1080)).toBeCloseTo(324, 6);
    // Below ~360px the proportional size collapses into mush, so it floors.
    expect(motifSize(360)).toBeCloseTo(MOTIF_MIN_SIZE, 6);
    expect(motifSize(128)).toBe(MOTIF_MIN_SIZE);
    expect(motifSize(1)).toBe(MOTIF_MIN_SIZE);
  });

  it("bleeds the motif off the right edge on purpose", () => {
    for (const [w, h] of FORMATS) {
      const origin = motifOrigin(w, h);
      expect(origin.x).toBeCloseTo(0.56 * w, 6);
      expect(origin.y).toBeCloseTo(0.95 * h, 6);
      // 0.56w + 4.06em of glyphs must overrun the card, or the "bleed" is a
      // centred block of text sitting in the corner.
      expect(origin.x + MOTIF_ADVANCE_EM * motifSize(w)).toBeGreaterThan(w);
      // ...and the baseline stays on the card.
      expect(origin.y).toBeLessThan(h);
    }
  });
});

describe("the motif artwork", () => {
  it("is a well-formed path in em units", () => {
    expect(MOTIF_UNITS_PER_EM).toBe(1000);
    expect(MOTIF_PATH.startsWith("M")).toBe(true);
    expect(MOTIF_PATH).toMatch(/^[MLQCZHVmlqczhv0-9 .,-]+$/);
  });

  it("carries all four glyphs", () => {
    // Each of 生き甲斐 contributes at least one subpath; a truncated copy-paste
    // would silently drop the tail.
    expect((MOTIF_PATH.match(/M/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("defaultBackdrop — opening on what the user actually did", () => {
  it("opens on Movement after a hard session", () => {
    expect(defaultBackdrop(true, ["running"])).toBe("movement");
    expect(defaultBackdrop(true, ["gym", "boxing"])).toBe("movement");
  });

  it("opens on Stillness for a gentle day", () => {
    expect(defaultBackdrop(true, ["yoga_mobility"])).toBe("stillness");
    expect(defaultBackdrop(true, ["walking", "hiking"])).toBe("stillness");
  });

  it("counts a mixed day as Movement", () => {
    // One hard effort is the story of the day, even alongside a walk.
    expect(defaultBackdrop(true, ["walking", "crossfit"])).toBe("movement");
  });

  it("opens on Stillness on a rest day", () => {
    expect(defaultBackdrop(false, [])).toBe("stillness");
    // Training toggled on but nothing itemised is not evidence of effort.
    expect(defaultBackdrop(true, [])).toBe("stillness");
  });

  it("never guesses a pillar the check-in cannot observe", () => {
    // Sauna, ice bath, fuel and sleep are not logged, so inferring them would
    // be inventing detail about someone's day on a card they will publish.
    const inferable = new Set(["movement", "stillness"]);
    for (const types of [[], ["running"], ["yoga_mobility"], ["swimming", "gym"]]) {
      expect(inferable.has(defaultBackdrop(true, types))).toBe(true);
    }
  });
});
