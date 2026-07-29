import { NextResponse } from "next/server";

import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { num } from "@/lib/wearables/http";
import { secondsToMinutes, type DailyMetric } from "@/lib/wearables/metrics";
import { storeMetrics } from "@/lib/wearables/sync";

/**
 * POST /api/wearables/garmin-push
 *
 * Garmin's Health API has no on-demand fetch — it pushes summaries here when a
 * watch syncs. Every other provider polls; this one cannot, which is why it is
 * the only vendor with its own route.
 *
 * IT MUST ANSWER 200 QUICKLY AND ALMOST ALWAYS. Garmin retries on non-2xx and
 * will disable a push endpoint that keeps failing, so a malformed payload is
 * logged and acknowledged rather than rejected: replaying a message we cannot
 * parse will not make it parseable, and refusing it risks the whole
 * integration being switched off at their end.
 *
 * IDENTITY comes from Garmin's own user id, which is why
 * `wearable_connections.external_user_id` exists. A push naming a user we do
 * not recognise is dropped — that is a stale grant on their side, not ours.
 */

interface GarminSummary {
  userId?: string;
  userAccessToken?: string;
  calendarDate?: string;
  steps?: number;
  restingHeartRateInBeatsPerMinute?: number;
  averageHeartRateInBeatsPerMinute?: number;
  activeKilocalories?: number;
  durationInSeconds?: number;
  /** Sleep push uses its own date field. */
  calendarDateLocal?: string;
  avgOvernightHrv?: number;
}

interface GarminPush {
  dailies?: GarminSummary[];
  sleeps?: GarminSummary[];
  hrv?: GarminSummary[];
}

export async function POST(request: Request) {
  let payload: GarminPush;
  try {
    payload = (await request.json()) as GarminPush;
  } catch {
    // Acknowledge: see the note above about Garmin disabling failing endpoints.
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  const supabase = createSupabaseAdmin();

  // Group by Garmin user so one lookup serves all of that user's summaries.
  const byUser = new Map<string, DailyMetric[]>();
  const add = (uid: string | undefined, m: DailyMetric | null) => {
    if (!uid || !m) return;
    byUser.set(uid, [...(byUser.get(uid) ?? []), m]);
  };
  const metric = (
    s: GarminSummary,
    name: DailyMetric["metric"],
    value: number | undefined,
  ): DailyMetric | null => {
    const date = s.calendarDate ?? s.calendarDateLocal;
    if (!date || value === undefined || !Number.isFinite(value)) return null;
    return { metric: name, date, value, source: "garmin" };
  };

  for (const d of payload.dailies ?? []) {
    add(d.userId, metric(d, "steps", num(d.steps)));
    add(d.userId, metric(d, "resting_heart_rate", num(d.restingHeartRateInBeatsPerMinute)));
    add(d.userId, metric(d, "active_calories", num(d.activeKilocalories)));
  }
  for (const s of payload.sleeps ?? []) {
    const secs = num(s.durationInSeconds);
    if (secs !== undefined) add(s.userId, metric(s, "sleep_minutes", secondsToMinutes(secs)));
  }
  for (const h of payload.hrv ?? []) {
    add(h.userId, metric(h, "hrv", num(h.avgOvernightHrv)));
  }

  if (byUser.size === 0) return NextResponse.json({ ok: true, stored: 0 });

  const { data: conns } = await supabase
    .from("wearable_connections")
    .select("user_id, external_user_id")
    .eq("provider", "garmin")
    .in("external_user_id", [...byUser.keys()]);

  const ours = new Map<string, string>();
  for (const c of conns ?? []) {
    ours.set(c.external_user_id as string, c.user_id as string);
  }

  let stored = 0;
  for (const [garminId, metrics] of byUser) {
    const userId = ours.get(garminId);
    // Unknown Garmin user: a grant that exists on their side and not ours.
    // Dropping it is correct — we have nowhere to put it and no way to ask.
    if (!userId) continue;
    try {
      stored += await storeMetrics(userId, "garmin", metrics);
    } catch (err) {
      // One user's write failing must not reject the whole push, or Garmin
      // retries the entire batch including everything that already landed.
      console.error("garmin push store failed:", err);
    }
  }

  return NextResponse.json({ ok: true, stored });
}
