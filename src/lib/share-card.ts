/**
 * The shareable check-in card, built to the Claude Design spec
 * ("Ikigaro Share Cards": Stone, Ledger, and the share sheet).
 *
 * Rendered entirely in the browser on a <canvas>. Two deliberate consequences:
 * the user's photo NEVER leaves their device (we upload nothing), and there is
 * no image-generation service to run or pay for.
 *
 * WHAT GOES ON THE CARD is user-controlled — see `ShareFields`. Energy and
 * sleep are supported but default to OFF: someone posting to Instagram has not
 * consented to publish how they slept, and a share sheet is exactly where an
 * accidental disclosure becomes permanent. Streak, training and points are the
 * celebratory bits and default ON. Biomarker data is never eligible.
 */

/* ------------------------------ templates ------------------------------- */

export type TemplateId = "stone" | "ledger";

export const TEMPLATES: { id: TemplateId; name: string; blurb: string }[] = [
  { id: "stone", name: "Stone", blurb: "Minimal" },
  { id: "ledger", name: "Ledger", blurb: "Data" },
];

/** The design's palette. Warmer and softer than the in-app tokens. */
export const PALETTE = {
  stoneBg: "#FBF9F5",
  stoneInk: "#3B322A",
  stoneMuted: "#6B6055",
  stoneFaint: "#8C8074",
  rule: "#D8CFC2",
  ledgerBg: "#332C25",
  ledgerInk: "#FBF9F5",
  terracotta: "#B5562D",
  clay: "#CD7144",
  clayLight: "#E7A97F",
} as const;

/* -------------------------------- formats -------------------------------- */

export type FormatId = "story" | "post" | "square";

export const FORMATS: { id: FormatId; name: string; w: number; h: number }[] = [
  { id: "story", name: "Story 9:16", w: 1080, h: 1920 },
  { id: "post", name: "Post 4:5", w: 1080, h: 1350 },
  { id: "square", name: "Square", w: 1080, h: 1080 },
];

export const DEFAULT_FORMAT: FormatId = "post";

export function formatSize(id: FormatId): { w: number; h: number } {
  const f = FORMATS.find((x) => x.id === id) ?? FORMATS[1];
  return { w: f.w, h: f.h };
}

/* --------------------------------- data ---------------------------------- */

export interface ShareFields {
  streak: boolean;
  training: boolean;
  points: boolean;
  energy: boolean;
  sleep: boolean;
}

/** Celebratory by default; anything about the body is opt-in. */
export const DEFAULT_FIELDS: ShareFields = {
  streak: true,
  training: true,
  points: true,
  energy: false,
  sleep: false,
};

export interface ShareCardInput {
  streak: number;
  pointsBalance: number;
  pointsEarned: number;
  trainingLogged: boolean;
  /** Human labels, e.g. ["Running", "Gym"]. What the card prints. */
  activities: string[];
  /**
   * The same activities as internal type keys, e.g. ["running", "gym"]. Used
   * only to pick which tonal backdrop the picker opens on — never rendered, so
   * that the card can't leak an internal identifier onto someone's timeline.
   */
  exerciseTypes: string[];
  /** 1–5, or null if not recorded. */
  energy: number | null;
  /** Hours, or null. */
  sleepHours: number | null;
  /** Personal invite code — the growth loop; empty string hides the line. */
  inviteCode: string;
  date: Date;
}

/* --------------------------------- copy ---------------------------------- */

const MAX_NAMED_ACTIVITIES = 2;

export function activityLabel(activities: string[], trainingLogged: boolean): string {
  if (!trainingLogged) return "Rest day";
  if (activities.length === 0) return "Trained";
  if (activities.length <= MAX_NAMED_ACTIVITIES) return activities.join(" · ");
  const named = activities.slice(0, MAX_NAMED_ACTIVITIES).join(" · ");
  return `${named} +${activities.length - MAX_NAMED_ACTIVITIES}`;
}

/** "Mon · 26 Jul", per the design's masthead. */
export function shortDate(date: Date): string {
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  const rest = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${weekday} · ${rest}`;
}

export function energyLabel(energy: number | null): string {
  if (energy === null) return "—";
  return `${energy} of 5`;
}

export function sleepLabel(hours: number | null): string {
  if (hours === null) return "—";
  // One decimal only when it isn't a whole number: "7h", "7.5h".
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}h`;
}

/**
 * The stat tiles shown under the hero, filtered by what the user chose to
 * share. Order is fixed so the layout doesn't jump around between renders.
 */
export interface StatTile {
  label: string;
  value: string;
  sub?: string;
  /**
   * True when the value is a figure rather than prose.
   *
   * Cormorant Garamond ships OLD-STYLE figures — "1" renders as a Roman "I" —
   * so numbers are set in Marcellus instead, which has lining figures. Deciding
   * this per FIELD rather than by sniffing for digits matters: "Walking /
   * Zone 2" contains a digit but is prose and belongs in the serif.
   */
  numeric?: boolean;
}

export function statTiles(input: ShareCardInput, fields: ShareFields): StatTile[] {
  const tiles: StatTile[] = [];

  if (fields.training) {
    tiles.push({
      label: "Trained",
      value: activityLabel(input.activities, input.trainingLogged),
    });
  }
  if (fields.points) {
    tiles.push({
      label: "Iki points",
      value: String(input.pointsBalance),
      sub: input.pointsEarned > 0 ? `+${input.pointsEarned} today` : undefined,
      numeric: true,
    });
  }
  if (fields.energy && input.energy !== null) {
    tiles.push({ label: "Energy", value: energyLabel(input.energy), numeric: true });
  }
  if (fields.sleep && input.sleepHours !== null) {
    tiles.push({ label: "Sleep", value: sleepLabel(input.sleepHours), numeric: true });
  }

  return tiles;
}

/** Bottom-right of every card — the reason sharing is worth building. */
export function inviteLine(inviteCode: string): string {
  return inviteCode ? `ikigaro.com/join · ${inviteCode}` : "ikigaro.com/join";
}

export function shareFileName(date: Date, template: TemplateId): string {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  return `ikigaro-${template}-${iso}.png`;
}

/* ------------------------- Ledger's week strip --------------------------- */

export interface WeekDay {
  /** Single-letter weekday initial, Monday-agnostic — derived from the date. */
  initial: string;
  /** True when we know the user checked in that day. */
  filled: boolean;
  /** The final cell is today, highlighted differently. */
  isToday: boolean;
}

/**
 * The last seven days for Ledger's bar strip, derived from the streak alone.
 *
 * We have no per-day history endpoint, so a day is marked filled only when the
 * current streak proves it. This can UNDER-report (a check-in before a broken
 * streak shows empty) but can never over-report, which is the right direction
 * to be wrong on something a user is about to publish.
 */
export function weekStrip(streak: number, today: Date): WeekDay[] {
  const initials = ["S", "M", "T", "W", "T", "F", "S"];
  const days: WeekDay[] = [];
  const safeStreak = Math.max(0, Math.trunc(streak));

  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    const daysAgo = offset;
    days.push({
      initial: initials[d.getDay()],
      filled: daysAgo < safeStreak,
      isToday: offset === 0,
    });
  }
  return days;
}

/* ------------------------------ image maths ------------------------------ */

export interface CoverRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Source rectangle for drawing an image "cover"-style into a box: fills it
 * completely, preserves aspect ratio, centre-crops the overflow.
 */
export function coverRect(
  srcWidth: number,
  srcHeight: number,
  boxWidth: number,
  boxHeight: number,
): CoverRect {
  if (srcWidth <= 0 || srcHeight <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };

  const srcAspect = srcWidth / srcHeight;
  const boxAspect = boxWidth / boxHeight;

  if (srcAspect > boxAspect) {
    const sw = srcHeight * boxAspect;
    return { sx: (srcWidth - sw) / 2, sy: 0, sw, sh: srcHeight };
  }
  const sh = srcWidth / boxAspect;
  return { sx: 0, sy: (srcHeight - sh) / 2, sw: srcWidth, sh };
}

/**
 * Largest font size at which `text` still fits `maxWidth`. `measureAtSize` is
 * injected so this is testable without a canvas.
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
