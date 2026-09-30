/**
 * The numbers behind the v2 Home score card (UI v2, section 4.1).
 *
 * Pure functions, no I/O, so each figure on the card can be tested without a
 * database and the markup never computes anything itself.
 */

import { daysBetweenUTC } from "./checkin";

/* ------------------------------ streak heatmap ----------------------------- */

/**
 * One day on the 30-day heatmap: checked in, partial, or none.
 *
 * "PARTIAL" MEANS ENERGY WITHOUT SLEEP. Energy is the only required field, so a
 * check-in that logged it and nothing else still counts for the streak but is
 * half a picture of the day. Sleep is the field every other screen leans on
 * (Recovery, Trends, the doctor summary), so its absence is the one worth
 * showing. A day with sleep logged is a full day whether or not training was.
 */
export type DayStatus = "g" | "p" | "n";

export interface CheckinDay {
  checkin_date: string; // YYYY-MM-DD
  sleep_hours: number | null;
  training_logged?: boolean | null;
  exercises?: unknown[] | null;
}

/** Thirty statuses, oldest first, the last one being `today`. */
export function last30Statuses(rows: CheckinDay[], today: string): DayStatus[] {
  const byDate = new Map(rows.map((r) => [r.checkin_date, r]));
  const out: DayStatus[] = [];
  for (let back = 29; back >= 0; back -= 1) {
    const row = byDate.get(shiftDate(today, -back));
    out.push(!row ? "n" : row.sleep_hours == null ? "p" : "g");
  }
  return out;
}

/** YYYY-MM-DD plus or minus whole days, in UTC like the rest of check-in. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------ pillar inputs ------------------------------ */

export interface WeekInputs {
  /** Days in the 7-day window with training logged. */
  trainingDays: number;
  /** Mean of the logged sleep hours in the window, or null if none logged. */
  avgSleep: number | null;
}

/** The 7 days ending on `endDate`, inclusive. */
export function weekInputs(rows: CheckinDay[], endDate: string): WeekInputs {
  const inWindow = rows.filter((r) => {
    const age = daysBetweenUTC(r.checkin_date, endDate);
    return age >= 0 && age < 7;
  });
  const trained = inWindow.filter(
    (r) => r.training_logged === true || (Array.isArray(r.exercises) && r.exercises.length > 0),
  ).length;
  const sleeps = inWindow.map((r) => r.sleep_hours).filter((s): s is number => s != null);
  return {
    trainingDays: trained,
    avgSleep: sleeps.length ? Math.round((sleeps.reduce((a, b) => a + b, 0) / sleeps.length) * 10) / 10 : null,
  };
}

export interface PanelCounts {
  inRange: number;
  total: number;
  /** Markers flagged for a closer look (the report's "Worth a look" list). */
  worthALook: number;
}

/** Sleep that fills the Recovery ring. Nine hours, per handoff v2 section 4.1. */
export const SLEEP_TARGET_HOURS = 9;

export interface PillarFractions {
  /** Training days this week / 7. */
  performance: number;
  /** Average sleep / 9h, capped at 1. Null when no sleep was logged. */
  recovery: number | null;
  /** Markers in range / markers read. Null before the first panel. */
  longevity: number | null;
}

export function pillarFractions(week: WeekInputs, panel: PanelCounts | null): PillarFractions {
  return {
    performance: clamp01(week.trainingDays / 7),
    recovery: week.avgSleep == null ? null : clamp01(week.avgSleep / SLEEP_TARGET_HOURS),
    longevity: panel && panel.total > 0 ? clamp01(panel.inRange / panel.total) : null,
  };
}

/**
 * The 0-100 iki score: the average of the pillars that have data.
 *
 * Chosen so the number and the three rings beside it can never disagree: the
 * rings ARE its inputs. A pillar with no data (no sleep logged, no panel yet)
 * is left out rather than counted as zero, since "we don't know" is not "you
 * scored nothing". Null only when none of the three has data.
 *
 * NOT the lifetime iki earned that drives rank (`users.iki_score`). Different
 * quantity, and the card shows both, labelled.
 */
export function ikiScore100(f: PillarFractions): number | null {
  const parts = [f.performance, f.recovery, f.longevity].filter((v): v is number => v != null);
  if (parts.length === 0) return null;
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/* --------------------------------- rewards --------------------------------- */

export interface RewardItem {
  name: string;
  partner: string | null;
  kind: string;
  points_cost: number;
  discount_value?: string | null;
  available_codes: number | null;
}

export type NextUnlock =
  /** The cheapest voucher the member cannot afford yet. */
  | { state: "locked"; name: string; partner: string | null; cost: number; remaining: number }
  /** Vouchers exist and every one of them is affordable. */
  | { state: "all-affordable" }
  /** No vouchers in stock at all (partners still being added). */
  | { state: "none" };

/**
 * What the Rewards tile and hero point at.
 *
 * Only vouchers with codes left count: pointing somebody at a voucher that is
 * sold out would set a goal they cannot reach.
 */
export function nextUnlock(items: RewardItem[], balance: number): NextUnlock {
  const vouchers = items.filter(
    (i) => i.kind === "voucher" && (i.available_codes == null || i.available_codes > 0),
  );
  if (vouchers.length === 0) return { state: "none" };
  const locked = vouchers
    .filter((v) => v.points_cost > balance)
    .sort((a, b) => a.points_cost - b.points_cost);
  if (locked.length === 0) return { state: "all-affordable" };
  const v = locked[0];
  return { state: "locked", name: v.name, partner: v.partner, cost: v.points_cost, remaining: v.points_cost - balance };
}

/** Filled dots out of `of`, for the Rewards dot grid. */
export function filledDots(balance: number, cost: number, of = 16): number {
  if (cost <= 0) return of;
  return Math.max(0, Math.min(of, Math.floor((balance / cost) * of)));
}
