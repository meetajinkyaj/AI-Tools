/**
 * Daily check-in reminder logic. Pure and dependency-free so it can be unit
 * tested and shared by the cron endpoint.
 *
 * A user is "due" a reminder when they have a push subscription but have not
 * checked in yet for the current day. (For the India-first beta the sender fires
 * once at 18:00 IST, and "today" is the UTC date — which equals the IST date at
 * that moment, matching how daily_checkins.checkin_date is stored.)
 */

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_id: string;
}

/** A subscription in the shape the web-push sender expects. */
export interface DueSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * The subscriptions to notify: every subscription whose user has NOT checked in
 * today. A user with several devices gets a push on each; a user who already
 * checked in gets none.
 */
export function subscriptionsToNotify(
  subs: PushSub[],
  checkedInUserIds: Set<string>,
): DueSubscription[] {
  return subs
    .filter((s) => !checkedInUserIds.has(s.user_id))
    .map((s) => ({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }));
}

/** Constant-time string compare for the shared cron secret. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
