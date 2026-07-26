"use client";

import { useEffect, useRef, useState } from "react";

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  coverRect,
  fitFontSize,
  shareCardCopy,
  shareFileName,
  type ShareCardInput,
} from "@/lib/share-card";
import { secondaryButtonClass } from "./ui";

/**
 * "Share your check-in" — the Strava-style image, rendered on a canvas in the
 * browser.
 *
 * Nothing is uploaded. The photo a user picks is read into a canvas and stays
 * on their device; we never see it, which is the only responsible default for
 * a health app and also means there is no image service to run.
 *
 * What the card may show is decided in `share-card.ts` — habit data only, never
 * health readings. Read the note there before adding a field.
 */

/* Brand colours, duplicated here because canvas can't read Tailwind tokens. */
const LINEN = "#F1E9DC";
const OBSIDIAN = "#1B1815";
const TERRACOTTA = "#B5562D";
const MUTED_ON_LINEN = "#6E645B";
const MUTED_ON_PHOTO = "rgba(241,233,220,0.82)";
/* Clay Ember — the brand's accent for use ON charcoal. Terracotta is tuned for
   the linen ground and goes muddy over a mid-tone photo. */
const CLAY = "#CD7144";

/** next/font generates hashed family names, so read them off the document. */
function brandFont(variable: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value || fallback;
}

/** The wordmark: lowercase "ikigaro" with a terracotta tittle over the i. */
function drawWordmark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  accent: string,
) {
  const display = brandFont("--font-cormorant", "Georgia, serif");
  ctx.font = `500 ${size}px ${display}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // "ı" is dotless, so the tittle can be placed (and coloured) precisely.
  const dotless = "ı";
  ctx.fillStyle = color;
  ctx.fillText(dotless, x, y);
  const iWidth = ctx.measureText(dotless).width;
  ctx.fillText("kigaro", x + iWidth, y);

  const r = size * 0.065;
  ctx.beginPath();
  ctx.arc(x + iWidth / 2, y - size * 0.72, r, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
}

async function drawCard(
  canvas: HTMLCanvasElement,
  input: ShareCardInput,
  photo: HTMLImageElement | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const copy = shareCardCopy(input);
  const onPhoto = photo !== null;

  const display = brandFont("--font-cormorant", "Georgia, serif");
  const label = brandFont("--font-marcellus", "Georgia, serif");
  const body = brandFont("--font-hanken", "system-ui, sans-serif");

  /* --- ground ------------------------------------------------------------ */
  if (photo) {
    const { sx, sy, sw, sh } = coverRect(
      photo.naturalWidth,
      photo.naturalHeight,
      CARD_WIDTH,
      CARD_HEIGHT,
    );
    ctx.drawImage(photo, sx, sy, sw, sh, 0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Scrim: text has to stay legible over an unknown photo. Darkest at the
    // bottom where the stats sit, with a lighter wash up top for the wordmark.
    const scrim = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
    scrim.addColorStop(0, "rgba(27,24,21,0.74)");
    scrim.addColorStop(0.3, "rgba(27,24,21,0.42)");
    scrim.addColorStop(0.62, "rgba(27,24,21,0.6)");
    scrim.addColorStop(1, "rgba(27,24,21,0.94)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  } else {
    ctx.fillStyle = LINEN;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }

  const ink = onPhoto ? LINEN : OBSIDIAN;
  const quiet = onPhoto ? MUTED_ON_PHOTO : MUTED_ON_LINEN;
  const accent = onPhoto ? CLAY : TERRACOTTA;
  const margin = 96;

  const contentWidth = CARD_WIDTH - margin * 2;

  /* --- masthead ---------------------------------------------------------- */
  drawWordmark(ctx, margin, margin + 56, 64, ink, accent);

  ctx.font = `400 22px ${label}`;
  ctx.fillStyle = quiet;
  ctx.textAlign = "left";
  ctx.letterSpacing = "6px";
  ctx.fillText("PERFORMANCE · RECOVERY · LONGEVITY", margin, margin + 108);
  ctx.letterSpacing = "0px";

  // Rule under the masthead, so the space below reads as composition rather
  // than as something that failed to load.
  const rule = onPhoto ? "rgba(241,233,220,0.28)" : "rgba(27,24,21,0.14)";
  ctx.strokeStyle = rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(margin, margin + 160);
  ctx.lineTo(CARD_WIDTH - margin, margin + 160);
  ctx.stroke();

  /* --- hero -------------------------------------------------------------- */
  // The number is set in Marcellus, NOT the display serif: Cormorant Garamond
  // uses old-style figures, where "1" is a Roman "I" — so a 1-day streak read
  // as the letter I on a card whose entire job is showing a number.
  const heroBaseline = CARD_HEIGHT * 0.52;
  ctx.textAlign = "left";
  const heroSize = fitFontSize(
    (size) => {
      ctx.font = `400 ${size}px ${label}`;
      return ctx.measureText(copy.headline).width;
    },
    contentWidth,
    340,
  );
  ctx.font = `400 ${heroSize}px ${label}`;
  ctx.fillStyle = ink;
  ctx.fillText(copy.headline, margin, heroBaseline);

  ctx.font = `400 38px ${label}`;
  ctx.fillStyle = accent;
  ctx.letterSpacing = "10px";
  ctx.fillText(copy.headlineLabel.toUpperCase(), margin + 6, heroBaseline + 72);
  ctx.letterSpacing = "0px";

  /* --- today ------------------------------------------------------------- */
  let y = heroBaseline + 180;
  if (copy.activityLine) {
    ctx.font = `500 46px ${body}`;
    ctx.fillStyle = ink;
    ctx.fillText(copy.activityLine, margin, y);
    y += 70;
  }
  if (copy.pointsLine) {
    ctx.font = `600 40px ${body}`;
    ctx.fillStyle = accent;
    ctx.fillText(copy.pointsLine, margin, y);
  }

  /* --- footer ------------------------------------------------------------ */
  const footerY = CARD_HEIGHT - margin;
  ctx.font = `400 30px ${body}`;
  ctx.fillStyle = quiet;
  ctx.textAlign = "left";
  ctx.fillText(copy.dateLine, margin, footerY);

  ctx.textAlign = "right";
  ctx.fillStyle = onPhoto ? LINEN : OBSIDIAN;
  ctx.fillText(copy.footer, CARD_WIDTH - margin, footerY);

  // Hairline above the footer, mirroring the masthead rule.
  ctx.strokeStyle = rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(margin, footerY - 52);
  ctx.lineTo(CARD_WIDTH - margin, footerY - 52);
  ctx.stroke();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function ShareCheckinCard({ input }: { input: ShareCardInput }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Redraw whenever the photo or the check-in data changes. Fonts must be
  // ready first, or the canvas silently falls back to a system serif.
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    void (async () => {
      try {
        await document.fonts.ready;
      } catch {
        /* draw with whatever is available */
      }
      if (!cancelled) await drawCard(canvas, input, photo);
    })();

    return () => {
      cancelled = true;
    };
  }, [input, photo]);

  function onPickPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setPhoto(img);
      setStatus(null);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      setStatus("That image couldn't be read. Try another one.");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  async function onShare() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setStatus(null);

    const blob = await canvasToBlob(canvas);
    if (!blob) {
      setStatus("Couldn't create the image. Please try again.");
      return;
    }

    const file = new File([blob], shareFileName(input.date), { type: "image/png" });

    // Native share sheet where it exists (every modern phone); a download
    // otherwise, which is what desktop browsers get.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        // Cancelling the sheet throws AbortError — not an error worth showing.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Saved to your downloads.");
  }

  return (
    <div className="flex flex-col gap-3">
      <canvas
        ref={canvasRef}
        aria-label="Your shareable check-in card"
        className="w-full rounded-card border border-border"
        style={{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }}
      />

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void onShare()} className={secondaryButtonClass}>
          Share
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={secondaryButtonClass}
        >
          {photo ? "Change photo" : "Add photo"}
        </button>
        {photo && (
          <button
            type="button"
            onClick={() => setPhoto(null)}
            className={secondaryButtonClass}
          >
            Remove photo
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPickPhoto}
        />
      </div>

      <p className="font-body text-xs text-muted">
        Your photo stays on your device — we never upload it. The card shows your
        streak and training only, never health readings.
      </p>
      {status && <p className="font-body text-xs text-muted">{status}</p>}
    </div>
  );
}
