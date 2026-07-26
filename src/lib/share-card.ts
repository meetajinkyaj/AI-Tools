/**
 * The shareable check-in card — the "Strava image" for Ikigaro.
 *
 * Rendered entirely in the browser on a <canvas>. Two deliberate consequences:
 * the user's photo NEVER leaves their device (we upload nothing), and there is
 * no image-generation service to run or pay for.
 *
 * WHAT GOES ON THE CARD — this is a privacy decision, not a layout one.
 * Only *habit* data is shareable: streak, whether they trained and at what,
 * and iki points. Self-reported energy, sleep hours, notes and anything
 * biomarker-derived are deliberately excluded. A user posting to Instagram is
 * not consenting to publish health readings, and a share sheet is exactly the
 * place where an accidental disclosure becomes permanent. Keep this list tight.
 */

/** Instagram's 4:5 feed size — the largest that isn't cropped in-feed. */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

export interface ShareCardInput {
  streak: number;
  pointsEarned: number;
  trainingLogged: boolean;
  /** Human labels, e.g. ["Running", "Gym"]. Empty when nothing was logged. */
  activities: string[];
  date: Date;
}

export interface ShareCardCopy {
  /** The hero number. */
  headline: string;
  /** Sits under the hero. */
  headlineLabel: string;
  /** One short line about today; empty string when there is nothing to say. */
  activityLine: string;
  /** Bottom-left stat, e.g. "+10 iki". Empty when nothing was earned. */
  pointsLine: string;
  dateLine: string;
  footer: string;
}

/** At most this many activities are named before we summarise. */
const MAX_NAMED_ACTIVITIES = 2;

export function shareCardCopy(input: ShareCardInput): ShareCardCopy {
  const { streak, pointsEarned, trainingLogged, activities, date } = input;

  let activityLine = "";
  if (trainingLogged && activities.length > 0) {
    if (activities.length <= MAX_NAMED_ACTIVITIES) {
      activityLine = activities.join(" · ");
    } else {
      const named = activities.slice(0, MAX_NAMED_ACTIVITIES).join(" · ");
      activityLine = `${named} +${activities.length - MAX_NAMED_ACTIVITIES}`;
    }
  } else if (trainingLogged) {
    activityLine = "Trained today";
  }

  return {
    headline: String(Math.max(0, Math.trunc(streak))),
    headlineLabel: streak === 1 ? "day streak" : "day streak",
    activityLine,
    pointsLine: pointsEarned > 0 ? `+${pointsEarned} iki` : "",
    dateLine: date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    footer: "app.ikigaro.com",
  };
}

/** A filename that sorts chronologically and says what it is. */
export function shareFileName(date: Date): string {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  return `ikigaro-check-in-${iso}.png`;
}

/**
 * Largest font size at which `text` still fits `maxWidth`.
 *
 * The hero number is set enormous, so a long streak ("365") would run off the
 * card at a fixed size. `measure` is injected so this stays testable without a
 * canvas — pass `(size) => ctx.measureText(...).width` at the call site.
 */
export function fitFontSize(
  measureAtSize: (size: number) => number,
  maxWidth: number,
  maxSize: number,
  minSize = 16,
): number {
  let size = Math.max(minSize, maxSize);
  while (size > minSize && measureAtSize(size) > maxWidth) {
    size -= 4;
  }
  return Math.max(minSize, size);
}

export interface CoverRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Source rectangle for drawing an image "cover"-style into a box: fills the box
 * completely, preserves aspect ratio, centre-crops the overflow. Without this a
 * portrait phone photo would letterbox or squash on a 4:5 card.
 */
export function coverRect(
  srcWidth: number,
  srcHeight: number,
  boxWidth: number,
  boxHeight: number,
): CoverRect {
  if (srcWidth <= 0 || srcHeight <= 0) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }

  const srcAspect = srcWidth / srcHeight;
  const boxAspect = boxWidth / boxHeight;

  if (srcAspect > boxAspect) {
    // Source is wider — crop the sides.
    const sw = srcHeight * boxAspect;
    return { sx: (srcWidth - sw) / 2, sy: 0, sw, sh: srcHeight };
  }
  // Source is taller — crop top and bottom.
  const sh = srcWidth / boxAspect;
  return { sx: 0, sy: (srcHeight - sh) / 2, sw: srcWidth, sh };
}
