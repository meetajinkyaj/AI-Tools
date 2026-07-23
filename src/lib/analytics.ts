/**
 * Beta analytics domain logic — the numbers the 0-to-1 checklist says to watch:
 * onboarding completion, activation (first panel), report→re-test conversion,
 * D1/D7/D30 retention, active counts, streaks, and the daily check-in series.
 *
 * Pure and dependency-free so it can be unit tested; the admin analytics route
 * feeds it plain rows. "Activity" on a day = a check-in OR an app_opened event,
 * so retention doesn't undercount users who opened the app without checking in.
 * (app_opened only accrues from the day this instrumentation deploys.)
 */

import { daysBetweenUTC } from "./checkin";

export interface UserRow {
  id: string;
  created_at: string; // ISO timestamp
}

export interface FunnelCounts {
  users: number;
  onboarded: number; // completed the onboarding form (profile has a name)
  activated: number; // uploaded their first panel (the "aha" moment)
  retested: number; // 2+ distinct panel dates (the loop closed)
}

export function computeFunnel(
  users: UserRow[],
  onboardedUserIds: Set<string>,
  panelDatesByUser: Map<string, Set<string>>,
): FunnelCounts {
  let onboarded = 0;
  let activated = 0;
  let retested = 0;
  for (const u of users) {
    if (onboardedUserIds.has(u.id)) onboarded++;
    const dates = panelDatesByUser.get(u.id);
    if (dates && dates.size >= 1) activated++;
    if (dates && dates.size >= 2) retested++;
  }
  return { users: users.length, onboarded, activated, retested };
}

export interface RetentionPoint {
  day: number; // 1 | 7 | 30
  eligible: number; // signed up at least `day` days before today
  retained: number; // active exactly `day` days after signup
  rate: number | null; // retained / eligible (null when nobody is eligible)
}

/**
 * Classic day-N retention: of users who signed up ≥N days ago, how many were
 * active exactly N days after signup. Small-cohort honest: eligible counts are
 * returned so the UI can show "2 of 3" instead of a misleading percentage.
 */
export function computeRetention(
  users: UserRow[],
  activeDatesByUser: Map<string, Set<string>>,
  today: string, // YYYY-MM-DD
  days: number[] = [1, 7, 30],
): RetentionPoint[] {
  return days.map((day) => {
    let eligible = 0;
    let retained = 0;
    for (const u of users) {
      const signup = u.created_at.slice(0, 10);
      if (daysBetweenUTC(signup, today) < day) continue;
      eligible++;
      const target = addDays(signup, day);
      if (activeDatesByUser.get(u.id)?.has(target)) retained++;
    }
    return {
      day,
      eligible,
      retained,
      rate: eligible > 0 ? Math.round((retained / eligible) * 100) / 100 : null,
    };
  });
}

export interface ActiveCounts {
  dau: number; // active today
  wau: number; // active in the last 7 days
  mau: number; // active in the last 30 days
}

export function computeActive(
  activeDatesByUser: Map<string, Set<string>>,
  today: string,
): ActiveCounts {
  let dau = 0;
  let wau = 0;
  let mau = 0;
  for (const dates of activeDatesByUser.values()) {
    let inDay = false;
    let inWeek = false;
    let inMonth = false;
    for (const d of dates) {
      const gap = daysBetweenUTC(d, today);
      if (gap < 0) continue; // future-dated noise
      if (gap === 0) inDay = true;
      if (gap < 7) inWeek = true;
      if (gap < 30) inMonth = true;
    }
    if (inDay) dau++;
    if (inWeek) wau++;
    if (inMonth) mau++;
  }
  return { dau, wau, mau };
}

export interface StreakBuckets {
  none: number; // no live streak
  short: number; // 1-6 days
  week: number; // 7-29 days
  month: number; // 30+
}

/**
 * Current-streak distribution. A streak is "live" if the user's latest check-in
 * was today or yesterday (same rule as displayStreak); otherwise it counts as
 * none regardless of its old length.
 */
export function computeStreakBuckets(
  latestCheckinByUser: Map<string, { date: string; streak: number }>,
  today: string,
): StreakBuckets {
  const buckets: StreakBuckets = { none: 0, short: 0, week: 0, month: 0 };
  for (const { date, streak } of latestCheckinByUser.values()) {
    const gap = daysBetweenUTC(date, today);
    const live = gap === 0 || gap === 1;
    const s = live ? streak : 0;
    if (s >= 30) buckets.month++;
    else if (s >= 7) buckets.week++;
    else if (s >= 1) buckets.short++;
    else buckets.none++;
  }
  return buckets;
}

export interface DayCount {
  date: string; // YYYY-MM-DD
  count: number;
}

/** Check-ins per day for the last `days` days (zero-filled, oldest first). */
export function dailySeries(
  checkinDates: string[],
  today: string,
  days = 14,
): DayCount[] {
  const counts = new Map<string, number>();
  for (const d of checkinDates) counts.set(d, (counts.get(d) ?? 0) + 1);
  const out: DayCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push({ date, count: counts.get(date) ?? 0 });
  }
  return out;
}

/** date (YYYY-MM-DD) + n days, in UTC. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
