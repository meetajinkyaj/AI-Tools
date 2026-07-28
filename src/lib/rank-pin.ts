/**
 * The Iki rank pin — Claude Design's "Iki Badges v3", the cloisonné enamel set.
 *
 * ONE SOURCE OF TRUTH, TWO CONSUMERS. The same builder produces the SVG that
 * renders inline in the app and the SVG that gets rasterised into the share
 * card's canvas. Duplicating the artwork for the second consumer is how the
 * two silently drift until someone posts a badge that doesn't match their app.
 *
 * The scene markup is lifted verbatim from the design document rather than
 * retraced, so what ships is what was drawn.
 *
 * RING TEXT IS OPTIONAL, and that is the whole reason this takes an option.
 * The ring lettering is Marcellus. Inline in the document that resolves fine;
 * inside an <img src="data:image/svg+xml,…">, which is how the canvas path
 * rasterises it, external fonts never load and the text silently vanishes or
 * falls back. So the share pipeline asks for the pin WITHOUT ring text and
 * draws that lettering itself, on canvas, once Marcellus has actually loaded.
 *
 * The kanji is always an outline path (see rank-kanji.ts) — it has no font
 * dependency in either consumer, which is what makes the seal safe to bake
 * into the SVG.
 */

import { RANK_KANJI_PATH, KANJI_UNITS_PER_EM, IKIGAI_GLYPHS } from "./rank-kanji";
import type { RankId } from "./iki-rank";

/* ------------------------------ tier tokens ------------------------------ */

export interface RankArt {
  /** Outer rim metal — the one token that changes most between tiers. */
  rim: string;
  /** Scene sky, and the chip's disc fill. */
  sky: string;
  /** Kanji ink on the chip. */
  chipInk: string;
  /** Seal plate and its stroke. Grandmaster inverts to gold-on-black. */
  hankoFill: string;
  hankoStroke: string;
  hankoInk: string;
  /** Scene border stroke. Gold on Grandmaster, near-black everywhere else. */
  border: string;
  borderWidth: number;
}

/** Gold. Reserved: the Grandmaster pin is the only thing in the product that uses it. */
export const IKI_GOLD = "#D9B36A";

const BAND = "#1C1611";
const BAND_GRANDMASTER = "#14110E";
const RING_INK = "#F4EFE6";

export const RANK_ART: Record<RankId, RankArt> = {
  rookie: {
    rim: "#C9BEAE", sky: "#EBD9B4", chipInk: "#6F6742",
    hankoFill: "#B5562D", hankoStroke: BAND, hankoInk: "#FBF9F5",
    border: BAND, borderWidth: 5,
  },
  apprentice: {
    rim: "#C4A878", sky: "#E3CFA4", chipInk: "#7E6238",
    hankoFill: "#B5562D", hankoStroke: BAND, hankoInk: "#FBF9F5",
    border: BAND, borderWidth: 5,
  },
  pro: {
    rim: "#C98A4F", sky: "#DBB584", chipInk: "#8F3F1D",
    hankoFill: "#B5562D", hankoStroke: BAND, hankoInk: "#FBF9F5",
    border: BAND, borderWidth: 5,
  },
  sensei: {
    rim: "#CD7144", sky: "#E0C79A", chipInk: "#3B322A",
    hankoFill: "#B5562D", hankoStroke: BAND, hankoInk: "#FBF9F5",
    border: BAND, borderWidth: 5,
  },
  grandmaster: {
    rim: IKI_GOLD, sky: "#26201A", chipInk: IKI_GOLD,
    hankoFill: IKI_GOLD, hankoStroke: BAND_GRANDMASTER, hankoInk: BAND_GRANDMASTER,
    border: IKI_GOLD, borderWidth: 4,
  },
};

/** The band ring. Grandmaster sits a shade darker so the gold reads hotter. */
function bandFor(id: RankId): string {
  return id === "grandmaster" ? BAND_GRANDMASTER : BAND;
}

/* -------------------------------- scenes --------------------------------- */

/**
 * The clipped scene inside each pin, verbatim from the design document.
 * Coordinates are in the pin's own 240x240 space.
 */
const RANK_SCENE: Record<RankId, string> =
{
  rookie:
    "<circle cx=\"120\" cy=\"120\" r=\"82\" fill=\"#EBD9B4\"/> <circle cx=\"120\" cy=\"100\" r=\"30\" fil" +
    "l=\"#CD7144\" stroke=\"#1C1611\" stroke-width=\"3.5\"/> <g stroke=\"#1C1611\" stroke-width=\"4\"" +
    " stroke-linecap=\"round\"> <line x1=\"120\" y1=\"62\" x2=\"120\" y2=\"50\"/> <line x1=\"94\" y1=\"7" +
    "4\" x2=\"85\" y2=\"65\"/> <line x1=\"146\" y1=\"74\" x2=\"155\" y2=\"65\"/> <line x1=\"82\" y1=\"100\" " +
    "x2=\"68\" y2=\"100\"/> <line x1=\"158\" y1=\"100\" x2=\"172\" y2=\"100\"/> </g> <rect x=\"48\" y=\"76" +
    "\" width=\"34\" height=\"11\" rx=\"5.5\" fill=\"#F4EFE6\" stroke=\"#1C1611\" stroke-width=\"3\"/> <" +
    "path d=\"M38 160 Q80 128 130 158 Q170 182 202 156 L202 202 L38 202 Z\" fill=\"#8A8259\" st" +
    "roke=\"#1C1611\" stroke-width=\"3.5\"/> <path d=\"M38 178 Q90 150 150 180 Q180 196 202 184 " +
    "L202 202 L38 202 Z\" fill=\"#6F6742\" stroke=\"#1C1611\" stroke-width=\"3.5\"/> <path d=\"M116" +
    " 196 C116 180 114 172 110 164\" fill=\"none\" stroke=\"#1C1611\" stroke-width=\"5\" stroke-li" +
    "necap=\"round\"/> <path d=\"M110 166 C94 162 88 148 92 136 C106 140 116 152 114 166 Z\" fi" +
    "ll=\"#7C7448\" stroke=\"#1C1611\" stroke-width=\"3.5\"/> <path d=\"M112 162 C116 146 128 136 " +
    "140 138 C138 152 128 162 114 166 Z\" fill=\"#8A8259\" stroke=\"#1C1611\" stroke-width=\"3.5\"" +
    "/>",
  apprentice:
    "<circle cx=\"120\" cy=\"120\" r=\"82\" fill=\"#E3CFA4\"/> <circle cx=\"84\" cy=\"80\" r=\"18\" fill=" +
    "\"#B5562D\" stroke=\"#1C1611\" stroke-width=\"3.5\"/> <rect x=\"146\" y=\"62\" width=\"34\" height" +
    "=\"11\" rx=\"5.5\" fill=\"#F4EFE6\" stroke=\"#1C1611\" stroke-width=\"3\"/> <path d=\"M38 140 Q75" +
    " 116 110 140 Q150 168 202 134 L202 202 L38 202 Z\" fill=\"#8A8259\" stroke=\"#1C1611\" stro" +
    "ke-width=\"3.5\"/> <path d=\"M38 168 Q80 146 120 172 Q160 194 202 168 L202 202 L38 202 Z\"" +
    " fill=\"#6F6742\" stroke=\"#1C1611\" stroke-width=\"3.5\"/> <path d=\"M96 202 C106 182 116 17" +
    "0 126 161 L142 161 C134 176 130 188 132 202 Z\" fill=\"#F4EFE6\" stroke=\"#1C1611\" stroke-" +
    "width=\"3.5\"/> <g stroke=\"#1C1611\" stroke-width=\"3\"> <rect x=\"116\" y=\"132\" width=\"5\" he" +
    "ight=\"26\" fill=\"#B5562D\"/> <rect x=\"142\" y=\"132\" width=\"5\" height=\"26\" fill=\"#B5562D\"/" +
    "> <rect x=\"108\" y=\"126\" width=\"47\" height=\"7\" rx=\"2\" fill=\"#B5562D\"/> <rect x=\"113\" y=" +
    "\"140\" width=\"37\" height=\"5\" fill=\"#B5562D\"/> </g>",
  pro:
    "<circle cx=\"120\" cy=\"120\" r=\"82\" fill=\"#DBB584\"/> <path d=\"M70 84 L75 90 L70 96 L65 90" +
    " Z\" fill=\"#F4EFE6\" stroke=\"#1C1611\" stroke-width=\"2.5\"/> <path d=\"M174 78 L179 84 L174" +
    " 90 L169 84 Z\" fill=\"#F4EFE6\" stroke=\"#1C1611\" stroke-width=\"2.5\"/> <path d=\"M62 128 L" +
    "67 134 L62 140 L57 134 Z\" fill=\"#F4EFE6\" stroke=\"#1C1611\" stroke-width=\"2.5\"/> <path d" +
    "=\"M180 124 L185 130 L180 136 L175 130 Z\" fill=\"#F4EFE6\" stroke=\"#1C1611\" stroke-width=" +
    "\"2.5\"/> <path d=\"M120 58 C138 76 152 96 152 118 C152 138 138 148 120 148 C102 148 88 1" +
    "38 88 118 C88 104 96 90 104 82 C102 96 108 102 112 100 C108 86 112 72 120 58 Z\" fill=\"" +
    "#B5562D\" stroke=\"#1C1611\" stroke-width=\"3.5\"/> <path d=\"M120 84 C130 96 138 106 138 12" +
    "0 C138 134 130 142 120 142 C110 142 102 134 102 120 C102 112 106 104 110 100 C110 108 " +
    "114 112 117 110 C114 100 116 92 120 84 Z\" fill=\"#CD7144\" stroke=\"#1C1611\" stroke-width" +
    "=\"3\"/> <circle cx=\"120\" cy=\"124\" r=\"10\" fill=\"#E7A97F\" stroke=\"#1C1611\" stroke-width=\"" +
    "3\"/> <path d=\"M88 150 L152 150 L146 168 L94 168 Z\" fill=\"#3B322A\" stroke=\"#1C1611\" str" +
    "oke-width=\"3.5\"/> <path d=\"M76 150 L88 150 L88 161 Q80 159 76 154 Z\" fill=\"#3B322A\" st" +
    "roke=\"#1C1611\" stroke-width=\"3\"/> <rect x=\"92\" y=\"168\" width=\"56\" height=\"13\" fill=\"#3" +
    "B322A\" stroke=\"#1C1611\" stroke-width=\"3.5\"/> <path d=\"M38 181 L202 181 L202 202 L38 20" +
    "2 Z\" fill=\"#6B5B45\" stroke=\"#1C1611\" stroke-width=\"3.5\"/>",
  sensei:
    "<circle cx=\"120\" cy=\"120\" r=\"82\" fill=\"#E0C79A\"/> <circle cx=\"160\" cy=\"82\" r=\"24\" fill" +
    "=\"#B5562D\" stroke=\"#1C1611\" stroke-width=\"3.5\"/> <path d=\"M120 74 C132 108 162 152 200" +
    " 194 L40 194 C80 152 108 108 120 74 Z\" fill=\"#3B322A\" stroke=\"#1C1611\" stroke-width=\"3" +
    ".5\"/> <path d=\"M120 74 C126 90 134 104 142 118 L134 112 L126 121 L118 112 L110 121 L10" +
    "2 112 L96 118 C104 104 114 90 120 74 Z\" fill=\"#FBF9F5\" stroke=\"#1C1611\" stroke-width=\"" +
    "3\"/> <rect x=\"50\" y=\"118\" width=\"34\" height=\"10\" rx=\"5\" fill=\"#F4EFE6\" stroke=\"#1C1611" +
    "\" stroke-width=\"3\"/> <rect x=\"150\" y=\"118\" width=\"36\" height=\"10\" rx=\"5\" fill=\"#F4EFE6" +
    "\" stroke=\"#1C1611\" stroke-width=\"3\"/> <path d=\"M38 194 L202 194 L202 202 L38 202 Z\" fi" +
    "ll=\"#6B5B45\" stroke=\"#1C1611\" stroke-width=\"3\"/>",
  grandmaster:
    "<circle cx=\"120\" cy=\"120\" r=\"82\" fill=\"#26201A\"/> <circle cx=\"70\" cy=\"60\" r=\"2.5\" fill" +
    "=\"#D9B36A\"/> <circle cx=\"150\" cy=\"50\" r=\"2.5\" fill=\"#D9B36A\"/> <circle cx=\"182\" cy=\"86" +
    "\" r=\"2.5\" fill=\"#D9B36A\"/> <circle cx=\"52\" cy=\"102\" r=\"2.5\" fill=\"#D9B36A\"/> <circle c" +
    "x=\"168\" cy=\"120\" r=\"2.5\" fill=\"#D9B36A\"/> <circle cx=\"84\" cy=\"78\" r=\"22\" fill=\"#D9B36A" +
    "\" stroke=\"#8A6A2E\" stroke-width=\"3\"/> <path d=\"M120 84 C134 118 164 156 200 194 L40 19" +
    "4 C78 154 106 118 120 84 Z\" fill=\"#14110E\" stroke=\"#D9B36A\" stroke-width=\"2.5\"/> <path" +
    " d=\"M110 120 L118 140 L108 158 L116 178\" fill=\"none\" stroke=\"#D9B36A\" stroke-width=\"2\"" +
    " stroke-linejoin=\"round\"/> <path d=\"M132 132 L128 150 L140 170\" fill=\"none\" stroke=\"#D" +
    "9B36A\" stroke-width=\"1.6\" stroke-linejoin=\"round\"/> <path d=\"M112 202 C116 190 122 182" +
    " 130 176 L142 176 C135 186 131 194 133 202 Z\" fill=\"#B08A3F\" stroke=\"#D9B36A\" stroke-w" +
    "idth=\"2.5\"/> <path d=\"M40 194 L200 194\" fill=\"none\" stroke=\"#D9B36A\" stroke-width=\"2.5" +
    "\"/>",
};

/* ------------------------------- the seal -------------------------------- */

/**
 * The hanko, as an outline path rather than a <text> element.
 *
 * Placed at translate(136 134) per the spec, a 38x38 plate with the glyph set
 * at 26px. The kanji is scaled from its 1000-unit em and nudged so it sits
 * optically centred in the plate: a kanji's ink box is squarer and lower than
 * a latin glyph's, so centring on the metric baseline alone leaves it looking
 * like it has slipped.
 */
function hanko(id: RankId, x: number, y: number, plate: number, glyph: number): string {
  const a = RANK_ART[id];
  const s = glyph / KANJI_UNITS_PER_EM;
  const gx = x + plate / 2 - glyph / 2;
  const gy = y + plate / 2 + glyph * 0.37;
  return (
    `<rect x="${x}" y="${y}" width="${plate}" height="${plate}" rx="${plate * 0.13}" ` +
    `fill="${a.hankoFill}" stroke="${a.hankoStroke}" stroke-width="3"/>` +
    `<path d="${RANK_KANJI_PATH[id]}" fill="${a.hankoInk}" ` +
    `transform="translate(${gx} ${gy}) scale(${s})"/>`
  );
}

/* ----------------------------- the ring arc ------------------------------ */

/** Ring radius, shared by both arcs. */
const RING_R = 97;
/** Bottom arc runs from theta 180deg round through the bottom to 0deg. */
const ARC_FROM = 180;
const ARC_TO = 0;

/**
 * Set 生き甲斐 along the bottom of the ring, one rotated outline per glyph.
 *
 * Each glyph sits at its own angle with its baseline tangent to the ring, which
 * is what a textPath would have done for us had the font been able to draw
 * these characters at all. Angles run 180deg -> 0deg through the bottom, so the
 * tangent at theta is (sin, -cos) and the glyph rotation follows from it; at
 * the very bottom that resolves to 0deg, i.e. upright, which is the sanity
 * check that the direction is not inverted.
 */
function ikigaiArc(fill: string): string {
  const size = 14;
  // Angular width of one glyph plus its tracking, at the ring radius.
  const stepDeg = ((size + 4) / RING_R) * (180 / Math.PI);
  // Centre the block left of the bottom, leaving the right for "· IKIGARO".
  const centreDeg = 118;
  const start = centreDeg + ((IKIGAI_GLYPHS.length - 1) / 2) * stepDeg;
  const s = size / KANJI_UNITS_PER_EM;

  return IKIGAI_GLYPHS.map((g, i) => {
    const deg = start - i * stepDeg;
    const t = (deg * Math.PI) / 180;
    const x = 120 + RING_R * Math.cos(t);
    const y = 120 + RING_R * Math.sin(t);
    const rot = (Math.atan2(-Math.cos(t), Math.sin(t)) * 180) / Math.PI;
    // Translate to the ring point, rotate onto the tangent, then step back by
    // half an em so the glyph straddles that point instead of starting at it.
    return (
      `<path d="${g.path}" fill="${fill}" transform="translate(${x.toFixed(2)} ` +
      `${y.toFixed(2)}) rotate(${rot.toFixed(2)}) scale(${s}) ` +
      `translate(${-KANJI_UNITS_PER_EM / 2} ${KANJI_UNITS_PER_EM * 0.36})"/>`
    );
  }).join("");
}

/* ------------------------------- the pin --------------------------------- */

export interface PinOptions {
  /**
   * Draw the curved rank name and 生き甲斐 · IKIGARO lettering.
   *
   * Leave this OFF for anything that rasterises the SVG through an <img>,
   * because Marcellus will not have loaded in that context. See the note at
   * the top of this file.
   */
  ringText?: boolean;
  /** Rendered into the SVG for screen readers. */
  title?: string;
}

/**
 * The full pin at hero size: rim, band, ring lettering, scene, seal.
 *
 * Per the design, this appears ONLY at hero size — detail view, level-up, and
 * the share card. Anything smaller uses the chip, because the scene turns to
 * mud below about 120px and a muddy pin reads as a rendering bug.
 */
export function rankPinSvg(id: RankId, name: string, opts: PinOptions = {}): string {
  const a = RANK_ART[id];
  const band = bandFor(id);
  const ring = opts.ringText
    ? `<defs>` +
      `<path id="rt-${id}" d="M23 120 A97 97 0 0 1 217 120"/>` +
      `<path id="rb-${id}" d="M23 120 A97 97 0 0 0 217 120"/>` +
      `</defs>` +
      `<text font-family="Marcellus, serif" font-size="16" letter-spacing="6" ` +
      `fill="${RING_INK}"><textPath href="#rt-${id}" startOffset="50%" ` +
      `text-anchor="middle">${name.toUpperCase()}</textPath></text>` +
      ikigaiArc(a.rim) +
      `<text font-family="Marcellus, serif" font-size="14" letter-spacing="4" ` +
      `fill="${a.rim}"><textPath href="#rb-${id}" startOffset="66%" ` +
      `text-anchor="middle">· IKIGARO</textPath></text>` +
      `<path d="M17 120 L23 114 L29 120 L23 126 Z" fill="${a.rim}"/>` +
      `<path d="M211 120 L217 114 L223 120 L217 126 Z" fill="${a.rim}"/>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img"` +
    (opts.title ? ` aria-label="${opts.title}"` : ` aria-hidden="true"`) +
    `>` +
    (opts.title ? `<title>${opts.title}</title>` : "") +
    `<clipPath id="pin-clip-${id}"><circle cx="120" cy="120" r="82"/></clipPath>` +
    `<circle cx="120" cy="120" r="113" fill="${a.rim}"/>` +
    `<circle cx="120" cy="120" r="108" fill="${band}"/>` +
    ring +
    `<g clip-path="url(#pin-clip-${id})">${RANK_SCENE[id]}</g>` +
    `<circle cx="120" cy="120" r="82" fill="none" stroke="${a.border}" ` +
    `stroke-width="${a.borderWidth}"/>` +
    hanko(id, 136, 134, 38, 26) +
    `</svg>`
  );
}

/**
 * The chip, for anything at or below 120px.
 *
 * Same silhouette, no scene, no ring text — just the seal colour and the
 * kanji, which is the part that still reads at thumbnail size. The rank card,
 * the case, and any list row use this.
 */
export function rankChipSvg(id: RankId, title?: string): string {
  const a = RANK_ART[id];
  const band = bandFor(id);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img"` +
    (title ? ` aria-label="${title}"` : ` aria-hidden="true"`) +
    `>` +
    (title ? `<title>${title}</title>` : "") +
    `<circle cx="60" cy="60" r="56" fill="${a.rim}"/>` +
    `<circle cx="60" cy="60" r="51" fill="${band}"/>` +
    `<circle cx="60" cy="60" r="42" fill="${a.sky}" stroke="${band}" stroke-width="3"/>` +
    `<path d="${RANK_KANJI_PATH[id]}" fill="${a.chipInk}" ` +
    `transform="translate(39 75) scale(${42 / KANJI_UNITS_PER_EM})"/>` +
    `</svg>`
  );
}

/** Data URI for the canvas path and for <img src>. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
