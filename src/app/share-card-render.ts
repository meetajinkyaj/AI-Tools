/**
 * Canvas rendering for the share card. Stone and Ledger, per the Claude
 * Design spec.
 *
 * Layout is expressed as three blocks (masthead / hero / footer) laid out with
 * space-between semantics, exactly as the design's flex columns are. That is
 * what lets one implementation serve 9:16, 4:5 and 1:1 without three sets of
 * hardcoded coordinates.
 *
 * All sizes in the design are quoted at 1080×1350; everything here scales from
 * the card width so the proportions hold at any format.
 */

import { MOTIF_PATH, MOTIF_UNITS_PER_EM } from "@/lib/ikigai-motif";
import {
  backdropById,
  GRADIENT_STOPS,
  gradientAxis,
  motifOrigin,
  motifSize,
  vignette,
  type BackdropId,
} from "@/lib/share-backdrop";
import {
  coverRect,
  fitFontSize,
  inviteLine,
  PALETTE,
  shortDate,
  statTiles,
  weekStrip,
  type ShareCardInput,
  type ShareFields,
  type TemplateId,
} from "@/lib/share-card";

const DESIGN_WIDTH = 1080;

/** next/font generates hashed family names, so read them off the document. */
function brandFont(variable: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value || fallback;
}

interface Ctx {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Scale factor from the 1080-wide design. */
  k: number;
  display: string;
  label: string;
  body: string;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
  rule: string;
  /**
   * True when a tonal backdrop is the ground. The backdrops are warm and
   * mid-dark by construction, which changes what can be drawn on them, see
   * the accent and week-strip choices below.
   */
  onBackdrop: boolean;
}

/** The wordmark, drawn rather than loaded, no asset to ship or 404. */
function drawWordmark(c: Ctx, x: number, baseline: number, size: number) {
  const { ctx } = c;
  ctx.font = `500 ${size}px ${c.display}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const dotless = "ı"; // dotless i, so the tittle can be placed and coloured
  ctx.fillStyle = c.ink;
  ctx.fillText(dotless, x, baseline);
  const iWidth = ctx.measureText(dotless).width;
  ctx.fillText("kigaro", x + iWidth, baseline);

  ctx.beginPath();
  ctx.arc(x + iWidth / 2, baseline - size * 0.72, size * 0.065, 0, Math.PI * 2);
  ctx.fillStyle = c.accent;
  ctx.fill();
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
  ctx.letterSpacing = `${(spacingEm * size).toFixed(2)}px`;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = "0px";
}

/** Masthead: wordmark left, date right. Shared by both templates. */
function drawMasthead(c: Ctx, input: ShareCardInput, pad: number) {
  const size = 56 * c.k;
  drawWordmark(c, pad, pad + size * 0.78, size);
  tracked(
    c,
    shortDate(input.date).toUpperCase(),
    c.w - pad,
    pad + size * 0.62,
    22 * c.k,
    0.28,
    c.faint,
    "right",
  );
}

/** Footer: 生き甲斐 left, invite line right. Shared by both templates. */
function drawFooter(c: Ctx, input: ShareCardInput, pad: number) {
  const y = c.h - pad;
  const { ctx } = c;

  // The tonal backdrops carry 生き甲斐 across the ground already. Printing it
  // again in the footer says the same word twice, a few hundred pixels apart.
  if (!c.onBackdrop) {
    ctx.font = `400 ${28 * c.k}px ${c.label}`;
    ctx.fillStyle = c.accent;
    ctx.textAlign = "left";
    ctx.fillText("生き甲斐", pad, y);
  }

  // Empty during the closed beta, see INVITE_LINK_ON_SHARED_CARDS. Drawing
  // an empty string is harmless but pointless, and the guard makes the absence
  // deliberate rather than incidental.
  const invite = inviteLine(input.inviteCode);
  if (!invite) return;

  // NOT uppercased, unlike every other tracked label on the card. This is a
  // URL: `?ref=` uppercased to `?REF=` is a different query parameter, so a
  // card that looked fine would silently fail to attribute the referral. The
  // code itself is already uppercase by construction (`cleanReferralInput`),
  // so the line still reads as intended.
  //
  // Set in `muted` rather than `faint`, one step up from the quietest tone on
  // the card. It shares the bottom-right corner with the backdrop motif, and
  // this is the one line someone has to be able to read and type: a link they
  // cannot make out is the same as no link.
  tracked(c, invite, c.w - pad, y, 20 * c.k, 0.2, c.muted, "right");
}

/**
 * The darkening wash that sits under the type on any image ground. Heavier at
 * the top and bottom, where the masthead and footer live, and lightest across
 * the middle so a photo's subject still reads.
 */
function drawScrim(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number,
) {
  const a = (alpha: number) => `rgba(38,32,26,${(alpha * strength).toFixed(3)})`;
  const scrim = ctx.createLinearGradient(0, 0, 0, height);
  scrim.addColorStop(0, a(0.72));
  scrim.addColorStop(0.3, a(0.4));
  scrim.addColorStop(0.62, a(0.62));
  scrim.addColorStop(1, a(0.92));
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, width, height);
}

/* ----------------------------- tonal backdrop ---------------------------- */

/**
 * Path2D is browser-only and the path never changes, so build it once, lazily.
 */
let motifPath: Path2D | null = null;
function ikigaiMotif(): Path2D {
  motifPath ??= new Path2D(MOTIF_PATH);
  return motifPath;
}

/**
 * Draws one of the six tonal grounds.
 *
 * Order is load-bearing: gradient → motif → vignette. Putting the vignette
 * above the motif is what keeps the glyphs' bleed off the right edge from
 * looking pasted on.
 */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  id: BackdropId,
  width: number,
  height: number,
) {
  const b = backdropById(id);

  const axis = gradientAxis(width, height);
  const grad = ctx.createLinearGradient(axis.x0, axis.y0, axis.x1, axis.y1);
  grad.addColorStop(GRADIENT_STOPS[0], b.highlight);
  grad.addColorStop(GRADIENT_STOPS[1], b.mid);
  grad.addColorStop(GRADIENT_STOPS[2], b.base);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const size = motifSize(width);
  const origin = motifOrigin(width, height);
  ctx.save();
  ctx.globalAlpha = b.motifOpacity;
  ctx.fillStyle = b.highlight;
  ctx.translate(origin.x, origin.y);
  ctx.scale(size / MOTIF_UNITS_PER_EM, size / MOTIF_UNITS_PER_EM);
  ctx.fill(ikigaiMotif());
  ctx.restore();

  const v = vignette(width, height);
  const radial = ctx.createRadialGradient(v.cx, v.cy, v.inner, v.cx, v.cy, v.outer);
  radial.addColorStop(0, v.from);
  radial.addColorStop(1, v.to);
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, width, height);
}

function hairline(c: Ctx, x1: number, x2: number, y: number, color: string) {
  const { ctx } = c;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, 1 * c.k);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

/* ------------------------------ Stone ------------------------------------ */

function drawStone(c: Ctx, input: ShareCardInput, fields: ShareFields) {
  const { ctx } = c;
  const pad = 88 * c.k;
  const contentW = c.w - pad * 2;

  drawMasthead(c, input, pad);

  /* hero: STREAK eyebrow, then a very large numeral beside "DAYS" */
  const tiles = statTiles(input, fields);
  const footerBlockH = (tiles.length > 0 ? 300 : 120) * c.k;
  // Space-between pins the hero just above the stats, which is right at 4:5 but
  // leaves a 9:16 story almost empty up top. Cap how far down it can sit.
  const heroBottom = Math.min(c.h - pad - footerBlockH, c.h * 0.66);

  if (fields.streak) {
    // Marcellus, not the display serif, see StatTile.numeric for why.
    const numSize = fitFontSize(
      (size) => {
        ctx.font = `400 ${size}px ${c.label}`;
        return ctx.measureText(String(input.streak)).width;
      },
      contentW * 0.62,
      400 * c.k,
    );
    const baseline = heroBottom - 40 * c.k;

    tracked(c, "STREAK", pad, baseline - numSize * 0.92, 24 * c.k, 0.3, c.accent);

    ctx.font = `400 ${numSize}px ${c.label}`;
    ctx.fillStyle = c.ink;
    ctx.textAlign = "left";
    ctx.fillText(String(input.streak), pad, baseline);
    const numW = ctx.measureText(String(input.streak)).width;

    tracked(
      c,
      "DAYS",
      pad + numW + 36 * c.k,
      baseline - 52 * c.k,
      40 * c.k,
      0.24,
      c.ink,
    );
  }

  /* footer block: rule, stat columns, rule, then the shared footer */
  if (tiles.length > 0) {
    const top = c.h - pad - 250 * c.k;
    hairline(c, pad, c.w - pad, top, c.rule);

    // The first column carries the longest value, so give it more room.
    const weights = tiles.map((_, i) => (i === 0 ? 1.4 : 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const gap = 48 * c.k;
    const usable = contentW - gap * (tiles.length - 1);

    let x = pad;
    tiles.forEach((tile, i) => {
      const colW = (usable * weights[i]) / totalWeight;
      tracked(c, tile.label.toUpperCase(), x, top + 60 * c.k, 20 * c.k, 0.28, c.faint);

      const face = tile.numeric ? c.label : c.display;
      const valueSize = fitFontSize(
        (size) => {
          ctx.font = `400 ${size}px ${face}`;
          return ctx.measureText(tile.value).width;
        },
        colW,
        52 * c.k,
        20 * c.k,
      );
      ctx.font = `400 ${valueSize}px ${face}`;
      ctx.fillStyle = c.ink;
      ctx.textAlign = "left";
      ctx.fillText(tile.value, x, top + 122 * c.k);

      if (tile.sub) {
        ctx.font = `400 ${24 * c.k}px ${c.body}`;
        ctx.fillStyle = c.muted;
        ctx.fillText(tile.sub, x, top + 164 * c.k);
      }
      x += colW + gap;
    });

    hairline(c, pad, c.w - pad, top + 206 * c.k, c.rule);
  }

  drawFooter(c, input, pad);
}

/* ------------------------------ Ledger ----------------------------------- */

function drawLedger(c: Ctx, input: ShareCardInput, fields: ShareFields) {
  const { ctx } = c;
  const pad = 88 * c.k;
  const contentW = c.w - pad * 2;

  drawMasthead(c, input, pad);

  const tiles = statTiles(input, fields);
  const tileRows = Math.ceil(tiles.length / 2);
  const gridH = tileRows > 0 ? tileRows * 140 * c.k : 0;
  const footerBlockH = gridH + 120 * c.k;

  /* hero: streak number with a label stack beside it */
  let y = pad + 200 * c.k;
  if (fields.streak) {
    // Marcellus, not the display serif, see StatTile.numeric for why.
    const numSize = fitFontSize(
      (size) => {
        ctx.font = `400 ${size}px ${c.label}`;
        return ctx.measureText(String(input.streak)).width;
      },
      contentW * 0.55,
      280 * c.k,
    );
    ctx.font = `400 ${numSize}px ${c.label}`;
    ctx.fillStyle = c.ink;
    ctx.textAlign = "left";
    const baseline = y + numSize * 0.78;
    ctx.fillText(String(input.streak), pad, baseline);
    const numW = ctx.measureText(String(input.streak)).width;

    tracked(
      c,
      "DAY STREAK",
      pad + numW + 32 * c.k,
      baseline - 60 * c.k,
      24 * c.k,
      0.3,
      c.accent,
    );
    ctx.font = `400 ${26 * c.k}px ${c.body}`;
    ctx.fillStyle = "rgba(251,249,245,0.62)";
    ctx.fillText(
      input.streak > 1 ? "Consistency compounds" : "Day one",
      pad + numW + 32 * c.k,
      baseline - 20 * c.k,
    );
    y = baseline + 90 * c.k;
  }

  /* last-seven-days strip */
  const stripTop = y;
  const stripBottom = c.h - pad - footerBlockH - 40 * c.k;
  if (stripBottom - stripTop > 120 * c.k) {
    tracked(c, "LAST SEVEN DAYS", pad, stripTop, 20 * c.k, 0.28, "rgba(251,249,245,0.45)");

    const days = weekStrip(input.streak, input.date);
    const gap = 18 * c.k;
    const barW = (contentW - gap * 6) / 7;
    const barH = Math.min(96 * c.k, stripBottom - stripTop - 70 * c.k);
    const barY = stripTop + 30 * c.k;

    // Terracotta bars read strongly on Ledger's own brown, and vanish into a
    // warm backdrop (1.4-1.9:1 on Movement and Stillness). There the fill goes
    // linen and today keeps Clay Ember, which now separates from its
    // neighbours by hue rather than fighting the ground for it.
    // Held at just over half strength on purpose. Solid linen reads as seven
    // blank placeholders rather than a filled week, what has to carry is the
    // difference between a filled bar and an empty one, not the bar's own
    // weight against the ground.
    const filledBar = c.onBackdrop ? "rgba(251,249,245,0.55)" : PALETTE.terracotta;
    const todayBar = c.onBackdrop ? PALETTE.clayLight : PALETTE.clay;
    const emptyBar = c.onBackdrop
      ? "rgba(20,17,14,0.28)"
      : "rgba(251,249,245,0.09)";

    days.forEach((day, i) => {
      const x = pad + i * (barW + gap);
      ctx.fillStyle = day.isToday ? todayBar : day.filled ? filledBar : emptyBar;
      ctx.fillRect(x, barY, barW, barH);

      if (day.isToday) {
        ctx.strokeStyle = PALETTE.clayLight;
        ctx.lineWidth = 2 * c.k;
        ctx.strokeRect(x - 4 * c.k, barY - 4 * c.k, barW + 8 * c.k, barH + 8 * c.k);
      }

      tracked(
        c,
        day.initial,
        x + barW / 2,
        barY + barH + 38 * c.k,
        20 * c.k,
        0.16,
        day.isToday ? PALETTE.clay : "rgba(251,249,245,0.45)",
        "center",
      );
    });
  }

  /* stat grid, 2 across, hairline-separated like the design */
  if (tiles.length > 0) {
    const gridTop = c.h - pad - footerBlockH;
    const cellW = contentW / 2;
    const cellH = 140 * c.k;

    tiles.forEach((tile, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = pad + col * cellW;
      const cy = gridTop + row * cellH;

      tracked(
        c,
        tile.label.toUpperCase(),
        x + 24 * c.k,
        cy + 44 * c.k,
        19 * c.k,
        0.28,
        "rgba(251,249,245,0.45)",
      );

      const face = tile.numeric ? c.label : c.display;
      const valueSize = fitFontSize(
        (size) => {
          ctx.font = `400 ${size}px ${face}`;
          return ctx.measureText(tile.value).width;
        },
        cellW - 56 * c.k,
        56 * c.k,
        20 * c.k,
      );
      ctx.font = `400 ${valueSize}px ${face}`;
      ctx.fillStyle = c.ink;
      ctx.textAlign = "left";
      ctx.fillText(tile.value, x + 24 * c.k, cy + 104 * c.k);
    });

    // Separators between cells.
    const sep = "rgba(251,249,245,0.14)";
    for (let row = 0; row <= tileRows; row++) {
      hairline(c, pad, c.w - pad, gridTop + row * cellH, sep);
    }
    if (tiles.length > 1) {
      ctx.strokeStyle = sep;
      ctx.lineWidth = Math.max(1, 1 * c.k);
      ctx.beginPath();
      ctx.moveTo(pad + cellW, gridTop);
      ctx.lineTo(pad + cellW, gridTop + tileRows * cellH);
      ctx.stroke();
    }
  }

  drawFooter(c, input, pad);
}

/* ------------------------------- entry ----------------------------------- */

export async function drawShareCard(
  canvas: HTMLCanvasElement,
  opts: {
    input: ShareCardInput;
    fields: ShareFields;
    template: TemplateId;
    width: number;
    height: number;
    photo: HTMLImageElement | null;
    backdrop: BackdropId | null;
  },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { input, fields, template, width, height, photo, backdrop } = opts;
  canvas.width = width;
  canvas.height = height;

  // A photo wins if both are somehow set, the user picked it more recently
  // and it is the more specific intent.
  const ground = photo ? "photo" : backdrop ? "backdrop" : "flat";
  const dark = template === "ledger" || ground !== "flat";

  const c: Ctx = {
    ctx,
    w: width,
    h: height,
    k: width / DESIGN_WIDTH,
    display: brandFont("--font-cormorant", "Georgia, serif"),
    label: brandFont("--font-marcellus", "Georgia, serif"),
    body: brandFont("--font-hanken", "system-ui, sans-serif"),
    ink: dark ? PALETTE.ledgerInk : PALETTE.stoneInk,
    muted: dark ? "rgba(251,249,245,0.62)" : PALETTE.stoneMuted,
    faint: dark ? "rgba(251,249,245,0.5)" : PALETTE.stoneFaint,
    // A warm accent on a warm ground disappears. Measured against the six
    // backdrops at the positions the accent actually occupies, Clay scores
    // 1.38:1 on Stillness and 1.55:1 on Movement, invisible. Clay Ember only
    // reaches 2.4-2.7:1 there, still under the 3:1 floor, and nothing else in
    // the palette is both warm and light enough. So on a backdrop the accent
    // gives way to linen (4.6:1 at worst) rather than being tuned. Photos keep
    // Clay: their scrim runs at full strength, which leaves it the headroom a
    // backdrop's lighter scrim does not.
    accent: ground === "backdrop"
      ? PALETTE.ledgerInk
      : dark
        ? PALETTE.clay
        : PALETTE.terracotta,
    rule: dark ? "rgba(251,249,245,0.14)" : PALETTE.rule,
    onBackdrop: ground === "backdrop",
  };

  /* ground */
  if (ground === "photo" && photo) {
    const { sx, sy, sw, sh } = coverRect(
      photo.naturalWidth,
      photo.naturalHeight,
      width,
      height,
    );
    ctx.drawImage(photo, sx, sy, sw, sh, 0, 0, width, height);
    // A baked scrim, per the design note: every number stays legible on any
    // photo, so the user never drags text or hunts for a dark patch.
    drawScrim(ctx, width, height, 1);
  } else if (ground === "backdrop" && backdrop) {
    drawBackdrop(ctx, backdrop, width, height);
    // The spec keeps the card's existing scrim over a backdrop, but at full
    // strength it flattens all six into the same near-black and the point of
    // having six is lost. They are already dark by construction, a photo
    // scrim exists to survive an arbitrary bright upload, which is not a
    // problem a known palette has. A third of it is enough to seat the type.
    drawScrim(ctx, width, height, 0.34);
  } else {
    ctx.fillStyle = template === "ledger" ? PALETTE.ledgerBg : PALETTE.stoneBg;
    ctx.fillRect(0, 0, width, height);
    if (template === "stone") {
      ctx.strokeStyle = PALETTE.rule;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, width - 2, height - 2);
    }
  }

  if (template === "ledger") drawLedger(c, input, fields);
  else drawStone(c, input, fields);
}
