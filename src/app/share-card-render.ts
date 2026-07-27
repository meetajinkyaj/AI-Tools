/**
 * Canvas rendering for the share card — Stone and Ledger, per the Claude
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
}

/** The wordmark, drawn rather than loaded — no asset to ship or 404. */
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
  ctx.font = `400 ${28 * c.k}px ${c.label}`;
  ctx.fillStyle = c.accent;
  ctx.textAlign = "left";
  ctx.fillText("生き甲斐", pad, y);

  tracked(
    c,
    inviteLine(input.inviteCode).toUpperCase(),
    c.w - pad,
    y,
    20 * c.k,
    0.24,
    c.faint,
    "right",
  );
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
    // Marcellus, not the display serif — see StatTile.numeric for why.
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
    // Marcellus, not the display serif — see StatTile.numeric for why.
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

    days.forEach((day, i) => {
      const x = pad + i * (barW + gap);
      ctx.fillStyle = day.isToday
        ? PALETTE.clay
        : day.filled
          ? PALETTE.terracotta
          : "rgba(251,249,245,0.09)";
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
  },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { input, fields, template, width, height, photo } = opts;
  canvas.width = width;
  canvas.height = height;

  const onPhoto = photo !== null;
  const dark = template === "ledger" || onPhoto;

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
    accent: dark ? PALETTE.clay : PALETTE.terracotta,
    rule: dark ? "rgba(251,249,245,0.14)" : PALETTE.rule,
  };

  /* ground */
  if (photo) {
    const { sx, sy, sw, sh } = coverRect(
      photo.naturalWidth,
      photo.naturalHeight,
      width,
      height,
    );
    ctx.drawImage(photo, sx, sy, sw, sh, 0, 0, width, height);

    // A baked scrim, per the design note: every number stays legible on any
    // photo, so the user never drags text or hunts for a dark patch.
    const scrim = ctx.createLinearGradient(0, 0, 0, height);
    scrim.addColorStop(0, "rgba(38,32,26,0.72)");
    scrim.addColorStop(0.3, "rgba(38,32,26,0.4)");
    scrim.addColorStop(0.62, "rgba(38,32,26,0.62)");
    scrim.addColorStop(1, "rgba(38,32,26,0.92)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, width, height);
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
