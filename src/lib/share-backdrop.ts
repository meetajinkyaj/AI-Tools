/**
 * Tonal backdrops for the share card, built to the Claude Design "Backdrop
 * spec · canvas render".
 *
 * Six grounds, one geometry. Every value here is normalised to the canvas, so
 * the same six specs render at Story, Post and Square with nothing re-authored
 * per format and nothing cropped.
 *
 * These are drawn, not shipped. Six JPEGs at 1080×1920 would be roughly a
 * megabyte of download that still has to be re-exported for each aspect ratio;
 * a gradient, a glyph and a vignette are a few hundred bytes of code that
 * adapt to any size. They also stay useful once real photography exists — a
 * tonal backdrop is the fallback when an upload is too bright for the scrim,
 * and the neutral option for anyone who doesn't want their room on the
 * internet.
 */

export type BackdropId =
  | "sauna"
  | "ice"
  | "movement"
  | "stillness"
  | "fuel"
  | "sleep";

export interface Backdrop {
  id: BackdropId;
  /** Pillar name, shown in the picker. */
  name: string;
  /** The design's colour note — "Cedar heat", "Wet stone". */
  note: string;
  /** Gradient stop at 0.0. Also the motif's fill. */
  highlight: string;
  /** Gradient stop at 0.46. */
  mid: string;
  /** Gradient stop at 1.0. */
  base: string;
  /**
   * Motif alpha. Tuned per pillar rather than shared: the darker the base, the
   * higher this goes, or the glyphs disappear into it.
   */
  motifOpacity: number;
}

/** Order is the picker's order, and follows the protocol's own pillar order. */
export const BACKDROPS: Backdrop[] = [
  {
    id: "movement",
    name: "Movement",
    note: "First light",
    highlight: "#CD7144",
    mid: "#8F3F1D",
    base: "#33231A",
    motifOpacity: 0.26,
  },
  {
    id: "sauna",
    name: "Sauna",
    note: "Cedar heat",
    highlight: "#7A4A22",
    mid: "#4A2E1C",
    base: "#241710",
    motifOpacity: 0.34,
  },
  {
    id: "ice",
    name: "Ice bath",
    note: "Wet stone",
    // Cold is the ABSENCE of warmth in this palette. Reaching for blue here
    // leaves the brand ramp entirely.
    highlight: "#6E6C63",
    mid: "#45443F",
    base: "#21211E",
    motifOpacity: 0.3,
  },
  {
    id: "stillness",
    name: "Stillness",
    note: "Sunlit linen",
    highlight: "#A6906F",
    mid: "#6B5B45",
    base: "#322A20",
    motifOpacity: 0.24,
  },
  {
    id: "fuel",
    name: "Fuel",
    note: "Olive stone",
    highlight: "#8A8259",
    mid: "#55503A",
    base: "#262319",
    motifOpacity: 0.28,
  },
  {
    id: "sleep",
    name: "Sleep",
    note: "Low ember",
    highlight: "#4A342A",
    mid: "#262019",
    base: "#14110E",
    motifOpacity: 0.42,
  },
];

export function backdropById(id: BackdropId): Backdrop {
  return BACKDROPS.find((b) => b.id === id) ?? BACKDROPS[0];
}

/* ------------------------------- geometry -------------------------------- */

/**
 * Gradient axis, as normalised endpoints rather than an angle. Expressed this
 * way the axis re-slants itself per aspect ratio, so the light always falls
 * top-left to bottom-right whatever the format.
 */
export function gradientAxis(width: number, height: number) {
  return { x0: 0.18 * width, y0: 0, x1: 0.86 * width, y1: 1.0 * height };
}

/** Stop offsets. Never add a fourth — banding shows on OLED at these values. */
export const GRADIENT_STOPS = [0, 0.46, 1] as const;

/** Radial overlay that keeps the corners from feeling flat. No grain, ever. */
export function vignette(width: number, height: number) {
  const maxEdge = Math.max(width, height);
  return {
    cx: 0.5 * width,
    cy: 0.42 * height,
    inner: 0.3 * maxEdge,
    outer: 0.92 * maxEdge,
    from: "rgba(0,0,0,0)",
    to: "rgba(0,0,0,0.14)",
  };
}

/**
 * Motif em size. Scales off the width alone, with a floor so the glyphs stay
 * readable in the picker's thumbnails — below roughly a 360px canvas the
 * proportional size collapses into mush.
 */
export const MOTIF_MIN_SIZE = 108;

export function motifSize(width: number): number {
  return Math.max(0.3 * width, MOTIF_MIN_SIZE);
}

/**
 * Where the motif's first glyph starts and sits. Past the right edge is the
 * point: at 0.56w with a 4.06em run it bleeds off deliberately.
 */
export function motifOrigin(width: number, height: number) {
  return { x: 0.56 * width, y: 0.95 * height };
}

/* -------------------------------- pairing -------------------------------- */

/**
 * Which backdrop to open the picker on, given what the user logged today.
 *
 * The point is that the picker feels like it already knows — most people will
 * never change it. Only Movement and Stillness can be inferred: the daily
 * check-in records training, energy and sleep hours, and nothing that would
 * distinguish a sauna session from an ice bath or a meal. Guessing those from
 * an exercise type would be inventing data about someone's day on a card they
 * are about to publish, so the other four stay a deliberate choice.
 */
const RESTORATIVE = new Set(["yoga_mobility", "walking", "hiking"]);

export function defaultBackdrop(
  trainingLogged: boolean,
  exerciseTypes: string[],
): BackdropId {
  if (!trainingLogged || exerciseTypes.length === 0) return "stillness";
  // A day of only gentle work reads as Stillness; anything with a hard effort
  // in it reads as Movement, even if the rest of the day was a walk.
  return exerciseTypes.every((t) => RESTORATIVE.has(t)) ? "stillness" : "movement";
}
