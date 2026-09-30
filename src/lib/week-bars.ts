/**
 * The seven bars on the Trends energy and sleep cards (UI v2, section 4.4).
 *
 * A CALENDAR WEEK ENDING TODAY, not "the last seven check-ins". A missed day is
 * an empty bar in its own place, so a gap in the habit is visible as a gap,
 * and today is always the rightmost bar.
 */

import { shiftDate } from "./home-summary";

export interface WeekBar {
  date: string; // YYYY-MM-DD
  /** S M T W T F S, for the label under the bar. */
  letter: string;
  value: number | null;
  isToday: boolean;
}

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

export function weekBars<T extends { checkin_date: string }>(
  series: T[],
  pick: (p: T) => number | null,
  today: string,
): WeekBar[] {
  const byDate = new Map(series.map((p) => [p.checkin_date, pick(p)]));
  return Array.from({ length: 7 }, (_, i) => {
    const date = shiftDate(today, i - 6);
    return {
      date,
      letter: LETTERS[new Date(`${date}T00:00:00Z`).getUTCDay()],
      value: byDate.get(date) ?? null,
      isToday: i === 6,
    };
  });
}

/** Earlier days fade: 0.55 for the oldest up to 0.95, and today is 1. */
export function barOpacity(index: number, isToday: boolean): number {
  if (isToday) return 1;
  return Math.round((0.55 + (index / 6) * 0.4) * 100) / 100;
}

/**
 * "+0.4" / "−0.4" for a delta pill. A true minus sign (U+2212), so the two
 * signs are the same width and the number does not jump when it flips.
 */
export function signed(delta: number, unit = ""): string {
  const abs = Math.round(Math.abs(delta) * 10) / 10;
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${abs}${unit}`;
}
