/**
 * Painting the rank share card onto a canvas.
 *
 * THE PIN GETS RASTERISED, THE TEXT DOES NOT. The pin arrives as an SVG string
 * from `rank-pin.ts` and is drawn through an <img>, which keeps one source of
 * truth for the artwork between the app and the card. But an SVG loaded that
 * way is its own document: it cannot see the page's fonts, so any <text> in it
 * would fall back or vanish. That is why the pin is requested WITHOUT ring
 * lettering and the ring is drawn here, on the canvas, in Marcellus, which by
 * then has genuinely loaded, because `drawRankCard` waits for it.
 *
 * The kanji seal needs no such care: it is an outline path inside the SVG, so
 * it rasterises with the artwork.
 */

import {
  RANK_PALETTE,
  rankCardDate,
  rankInviteLine,
  type RankCardInput,
} from "@/lib/rank-share-card";
import { IKIGAI_GLYPHS, KANJI_UNITS_PER_EM } from "@/lib/rank-kanji";
import { RANK_ART, rankPinSvg, svgDataUri } from "@/lib/rank-pin";

const DESIGN_WIDTH = 1080;

function brandFont(variable: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v || fallback;
}

interface Ctx {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Scale from the 1080-wide design. */
  k: number;
  display: string;
  label: string;
}

function tracked(
  c: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
  spacingEm: number,
  color: string,
  align: CanvasTextAlign = "left",
) {
  const { ctx } = c;
  ctx.font = `400 ${size}px ${c.label}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = `${(spacingEm * size).toFixed(2)}px`;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = "0px";
}

/** 生き甲斐 from outlines, the same reason as everywhere else: no JP font. */
function drawIkigai(c: Ctx, x: number, baseline: number, size: number, color: string) {
  const { ctx } = c;
  const s = size / KANJI_UNITS_PER_EM;
  ctx.save();
  ctx.fillStyle = color;
  let penX = x;
  for (const g of IKIGAI_GLYPHS) {
    ctx.save();
    ctx.translate(penX, baseline);
    ctx.scale(s, s);
    ctx.fill(new Path2D(g.path));
    ctx.restore();
    penX += size * 1.02;
  }
  ctx.restore();
}

/** Load an SVG string into an image the canvas can draw. */
function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = svgDataUri(svg);
  });
}

/**
 * Ring lettering, drawn per character around the pin.
 *
 * Canvas has no textPath, so each glyph is placed at its own angle and rotated
 * onto the tangent. `flip` switches between the top arc, where the glyphs face
 * outward, and the bottom, where they have to be turned over to stay readable.
 */
function drawRingText(
  c: Ctx,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  size: number,
  color: string,
  opts: { centreAt: number; flip: boolean },
) {
  const { ctx } = c;
  ctx.save();
  ctx.font = `400 ${size}px ${c.label}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const chars = [...text];
  const spacing = size * 0.42;
  const widths = chars.map((ch) => ctx.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0);
  const dir = opts.flip ? -1 : 1;
  let angle = opts.centreAt - (dir * total) / radius / 2;

  for (let i = 0; i < chars.length; i++) {
    const step = (dir * widths[i]) / radius;
    const at = angle + step / 2;
    ctx.save();
    ctx.translate(cx + radius * Math.cos(at), cy + radius * Math.sin(at));
    ctx.rotate(at + (opts.flip ? -Math.PI / 2 : Math.PI / 2));
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    angle += step;
  }
  ctx.restore();
}

/**
 * 生き甲斐 around the bottom of the ring, from outlines.
 *
 * The kanji cannot go through `drawRingText`, that measures and fills text,
 * and no font in this product carries these characters. Same fix as everywhere
 * else: place each outline at its own angle, rotated onto the tangent.
 */
function drawIkigaiRing(
  c: Ctx,
  cx: number,
  cy: number,
  radius: number,
  size: number,
  color: string,
  centreAt: number,
) {
  const { ctx } = c;
  const s = size / KANJI_UNITS_PER_EM;
  const step = (size * 1.24) / radius;
  let angle = centreAt + ((IKIGAI_GLYPHS.length - 1) / 2) * step;

  ctx.save();
  ctx.fillStyle = color;
  for (const g of IKIGAI_GLYPHS) {
    ctx.save();
    ctx.translate(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
    // Bottom of the ring: turn the glyph over so it reads right way up.
    ctx.rotate(angle - Math.PI / 2);
    ctx.scale(s, s);
    ctx.translate(-KANJI_UNITS_PER_EM / 2, KANJI_UNITS_PER_EM * 0.36);
    ctx.fill(new Path2D(g.path));
    ctx.restore();
    angle -= step;
  }
  ctx.restore();
}

export async function drawRankCard(
  canvas: HTMLCanvasElement,
  opts: { input: RankCardInput; width: number; height: number },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { input, width, height } = opts;
  canvas.width = width;
  canvas.height = height;

  const c: Ctx = {
    ctx,
    w: width,
    h: height,
    k: width / DESIGN_WIDTH,
    display: brandFont("--font-cormorant", "Georgia, serif"),
    label: brandFont("--font-marcellus", "Georgia, serif"),
  };

  // Marcellus must be resolved before anything is measured or painted, or the
  // ring is laid out against the fallback's metrics and then redrawn in the
  // real face at different widths.
  if (typeof document !== "undefined" && document.fonts) {
    try {
      await document.fonts.load(`400 ${40 * c.k}px ${c.label}`);
      await document.fonts.ready;
    } catch {
      // A font that refuses to load is not a reason to render nothing.
    }
  }

  const art = RANK_ART[input.rankId];
  const pad = 72 * c.k;

  // Ground: the radial the design specifies, centred a third of the way down
  // so the light sits behind the pin rather than behind the stats.
  const g = ctx.createRadialGradient(
    width / 2, height * 0.34, 0,
    width / 2, height * 0.34, Math.max(width, height) * 0.72,
  );
  g.addColorStop(0, RANK_PALETTE.groundInner);
  g.addColorStop(1, RANK_PALETTE.groundOuter);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // Masthead date.
  tracked(
    c, rankCardDate(input.date).toUpperCase(),
    width / 2, pad + 22 * c.k, 22 * c.k, 0.28, RANK_PALETTE.faint, "center",
  );

  /* -------------------------------- the pin ------------------------------- */

  // Sized off the SHORTER of the two constraints so the tall Story ratio does
  // not blow the pin past the card's width, and the Square does not push the
  // stats off the bottom.
  const pin = Math.min(width * 0.62, height * 0.42);
  const pinX = (width - pin) / 2;

  // Centre the whole block rather than pinning it to a fraction of the height.
  // Measuring from the top worked at 4:5 and left a third of the 9:16 Story
  // card empty below the stats, because the content does not grow with the
  // canvas, only the space around it does.
  const nameGap = 96 * c.k;
  const blockH = pin + nameGap + 44 * c.k + 72 * c.k + 76 * c.k + 62 * c.k;
  const top = pad + 60 * c.k;
  const bottom = height - pad - 40 * c.k;
  // Optical centre sits slightly above true centre; a block centred exactly
  // between the date and the footer reads as low.
  const pinY = Math.max(top, top + (bottom - top - blockH) * 0.42);

  try {
    const img = await loadSvg(rankPinSvg(input.rankId, input.rankName, { ringText: false }));
    ctx.drawImage(img, pinX, pinY, pin, pin);
  } catch {
    // If the SVG will not decode, a bare disc still reads as a badge and the
    // rest of the card, which is the actual message, survives.
    ctx.beginPath();
    ctx.arc(pinX + pin / 2, pinY + pin / 2, pin * 0.47, 0, Math.PI * 2);
    ctx.fillStyle = art.rim;
    ctx.fill();
  }

  // The ring lettering the SVG deliberately left out: rank name over the top,
  // 生き甲斐 · IKIGARO under the bottom, and the two divider diamonds between.
  const cx = pinX + pin / 2;
  const cy = pinY + pin / 2;
  const ringR = pin * 0.404;
  drawRingText(
    c, input.rankName.toUpperCase(), cx, cy, ringR,
    pin * 0.067, "#F4EFE6", { centreAt: -Math.PI / 2, flip: false },
  );
  drawIkigaiRing(c, cx, cy, ringR, pin * 0.058, art.rim, Math.PI * 0.72);
  drawRingText(
    c, "· IKIGARO", cx, cy, ringR,
    pin * 0.058, art.rim, { centreAt: Math.PI * 0.36, flip: true },
  );
  for (const side of [-1, 1]) {
    const d = pin * 0.026;
    ctx.save();
    ctx.translate(cx + side * ringR, cy);
    ctx.beginPath();
    ctx.moveTo(0, -d);
    ctx.lineTo(d, 0);
    ctx.lineTo(0, d);
    ctx.lineTo(-d, 0);
    ctx.closePath();
    ctx.fillStyle = art.rim;
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------- the copy ------------------------------- */

  let y = pinY + pin + 96 * c.k;

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 ${104 * c.k}px ${c.display}`;
  ctx.fillStyle = RANK_PALETTE.ink;
  ctx.fillText(input.rankName, width / 2, y);

  y += 44 * c.k;
  tracked(
    c, `${input.kanji} · ${input.scene}`,
    width / 2, y, 24 * c.k, 0.3, RANK_PALETTE.accent, "center",
  );

  /* ------------------------------- the stats ------------------------------ */

  y += 72 * c.k;
  ctx.fillStyle = RANK_PALETTE.rule;
  ctx.fillRect(pad, y, width - pad * 2, Math.max(1, 2 * c.k));

  y += 76 * c.k;
  const cells: [string, string][] = [
    ["Iki", input.ikiScore.toLocaleString()],
    ...(input.streak > 0
      ? ([["Streak", String(input.streak)]] as [string, string][])
      : []),
  ];
  const slot = (width - pad * 2) / cells.length;
  cells.forEach(([label, value], i) => {
    const cx = pad + slot * i + slot / 2;
    tracked(c, label.toUpperCase(), cx, y, 20 * c.k, 0.26, RANK_PALETTE.faint, "center");
    ctx.textAlign = "center";
    ctx.font = `500 ${64 * c.k}px ${c.display}`;
    ctx.fillStyle = RANK_PALETTE.ink;
    ctx.fillText(value, cx, y + 62 * c.k);
  });

  /* ------------------------------- the foot ------------------------------- */

  const footY = height - pad;
  drawIkigai(c, pad, footY, 32 * c.k, RANK_PALETTE.accent);

  const invite = rankInviteLine(input.referralCode);
  if (invite) {
    // NOT uppercased. The check-in card learned this the hard way: the tracked
    // label helper upper-cases, which turns "?ref=" into "?REF=", a different
    // query parameter, and a link that silently drops the attribution.
    ctx.font = `400 ${20 * c.k}px ${c.label}`;
    ctx.fillStyle = RANK_PALETTE.faint;
    ctx.textAlign = "right";
    ctx.letterSpacing = `${(0.24 * 20 * c.k).toFixed(2)}px`;
    ctx.fillText(invite, width - pad, footY);
    ctx.letterSpacing = "0px";
  }
}
