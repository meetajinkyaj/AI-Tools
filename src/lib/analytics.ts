/**
 * Beta analytics domain logic, the numbers the 0-to-1 checklist says to watch:
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
  /**
   * Below this many eligible users, `rate` comes back null and only the raw
   * counts are reported.
   *
   * One is the default because the whole-population figure has always shown
   * "2 of 3" rather than a percentage, and the UI is built for that. It exists
   * as a parameter for the segmented view below, where a percentage off a
   * two-person cohort is not a small sample, it is a wrong answer with a
   * decimal point.
   */
  minCohort = 1,
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
      rate:
        eligible >= minCohort && eligible > 0
          ? Math.round((retained / eligible) * 100) / 100
          : null,
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

/* -------------------------------------------------------------------------- */
/* Devices, and whether owning one changes anything                           */
/* -------------------------------------------------------------------------- */

/** One `wearable_connections` row, as the report needs it. */
export interface DeviceRow {
  user_id: string;
  provider: string;
  status: string;
  last_sync_at: string | null;
}

export interface ProviderAdoption {
  provider: string;
  /** Distinct users who have granted access. */
  connected: number;
  /** Distinct users whose connection has actually returned data at least once. */
  syncing: number;
  /** Connections the sweep has given up on until the member reconnects. */
  needsReauth: number;
}

export interface DeviceAdoption {
  /** Users with at least one connection, in any state. */
  usersWithAnyDevice: number;
  /** Users with at least one connection that has ever synced. */
  usersSyncing: number;
  /** Per provider, busiest first. */
  byProvider: ProviderAdoption[];
}

/**
 * Who has connected what, and whether it is working.
 *
 * CONNECTED AND SYNCING ARE COUNTED SEPARATELY, and the gap between them is the
 * number worth watching. Connecting is a statement of intent that takes one
 * tap; syncing means the grant, the scopes, the token encryption and the
 * vendor's API all held. Every wearable incident in this project's history sat
 * precisely in that gap: a row saying `active` with nothing behind it. One
 * column would have hidden all of them.
 */
export function computeDeviceAdoption(devices: DeviceRow[]): DeviceAdoption {
  const anyByUser = new Set<string>();
  const syncingByUser = new Set<string>();
  const perProvider = new Map<
    string,
    { connected: Set<string>; syncing: Set<string>; needsReauth: number }
  >();

  for (const d of devices) {
    if (!d?.user_id || !d.provider) continue;
    const bucket =
      perProvider.get(d.provider) ??
      { connected: new Set<string>(), syncing: new Set<string>(), needsReauth: 0 };
    bucket.connected.add(d.user_id);
    anyByUser.add(d.user_id);
    if (d.last_sync_at) {
      bucket.syncing.add(d.user_id);
      syncingByUser.add(d.user_id);
    }
    if (d.status === "expired") bucket.needsReauth += 1;
    perProvider.set(d.provider, bucket);
  }

  const byProvider = [...perProvider.entries()]
    .map(([provider, b]) => ({
      provider,
      connected: b.connected.size,
      syncing: b.syncing.size,
      needsReauth: b.needsReauth,
    }))
    .sort((a, b) => b.connected - a.connected || a.provider.localeCompare(b.provider));

  return {
    usersWithAnyDevice: anyByUser.size,
    usersSyncing: syncingByUser.size,
    byProvider,
  };
}

/**
 * The smallest cohort that gets a percentage in the segmented report.
 *
 * WHY IT IS NOT 1. The question this report answers is "do members with a
 * device stick around longer", and that is a COMPARISON. One retained user out
 * of two is 50%; the same user out of one is 100%; neither is evidence, and
 * both look like evidence next to a bar chart. At five, a single person moves
 * the figure by twenty points, which is still weak but is at least visibly
 * weak. Below it the counts are shown and the rate is withheld.
 *
 * This will suppress most of the report during a closed beta. That is the
 * correct behaviour, not a limitation to work around: the alternative is a
 * dashboard that manufactures a retention story out of four people.
 */
export const MIN_SEGMENT_COHORT = 5;

export interface SegmentRetention {
  segment: "device" | "no_device";
  /** Users in the segment, before day-N eligibility is applied. */
  users: number;
  points: RetentionPoint[];
}

/**
 * Day-N retention split by whether the member has ever connected a device.
 *
 * SEGMENTED ON "EVER CONNECTED", NOT "CONNECTED NOW". Someone who connected and
 * later disconnected still had the experience whose effect we are measuring,
 * and dropping them would quietly select for the happy path: the people most
 * likely to leave are exactly the ones who would fall out of the segment.
 *
 * WHAT THIS CANNOT TELL YOU, and the report says so on screen. Members who
 * connect a device are already the more engaged ones, so any gap here is
 * correlation and mostly self-selection. It is a reason to ask a question, not
 * an answer to one, and reading it as "devices cause retention" would be the
 * kind of mistake that gets a feature built on nothing.
 */
export function retentionBySegment(
  users: UserRow[],
  activeDatesByUser: Map<string, Set<string>>,
  deviceUserIds: Set<string>,
  today: string,
  days: number[] = [1, 7, 30],
): SegmentRetention[] {
  const withDevice = users.filter((u) => deviceUserIds.has(u.id));
  const without = users.filter((u) => !deviceUserIds.has(u.id));
  return [
    {
      segment: "device" as const,
      users: withDevice.length,
      points: computeRetention(withDevice, activeDatesByUser, today, days, MIN_SEGMENT_COHORT),
    },
    {
      segment: "no_device" as const,
      users: without.length,
      points: computeRetention(without, activeDatesByUser, today, days, MIN_SEGMENT_COHORT),
    },
  ];
}

export interface SegmentActivity {
  segment: "device" | "no_device";
  users: number;
  /** Users active on at least one of the last `window` days. */
  active: number;
  /** Mean active days per user over the window. Null when the segment is empty. */
  meanActiveDays: number | null;
}

/**
 * Active days per member over a window, split the same way.
 *
 * WHY THIS SITS BESIDE DAY-N RETENTION. Day-N asks whether somebody came back
 * on one specific day, which at this scale is close to a coin toss: a member
 * who used the app on days 6 and 8 counts as lost at D7. Mean active days uses
 * every day instead of one, so it says something with four users where day-N
 * retention cannot. It is the number to read first while the beta is small.
 */
export function activityBySegment(
  users: UserRow[],
  activeDatesByUser: Map<string, Set<string>>,
  deviceUserIds: Set<string>,
  today: string,
  window = 30,
): SegmentActivity[] {
  const measure = (group: UserRow[], segment: "device" | "no_device"): SegmentActivity => {
    let active = 0;
    let totalDays = 0;
    for (const u of group) {
      let days = 0;
      for (const d of activeDatesByUser.get(u.id) ?? []) {
        const gap = daysBetweenUTC(d, today);
        if (gap >= 0 && gap < window) days += 1;
      }
      if (days > 0) active += 1;
      totalDays += days;
    }
    return {
      segment,
      users: group.length,
      active,
      meanActiveDays:
        group.length > 0 ? Math.round((totalDays / group.length) * 10) / 10 : null,
    };
  };
  return [
    measure(users.filter((u) => deviceUserIds.has(u.id)), "device"),
    measure(users.filter((u) => !deviceUserIds.has(u.id)), "no_device"),
  ];
}
