import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import { todayUTC } from "@/lib/checkin";
import { getOrCreateSelfProfileId } from "@/lib/profiles";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import {
  type CheckinTrainingRow,
  recoveryView,
  trainingLoad,
  type WorkoutRow,
} from "@/lib/training";
import { mergeMetrics, type MetricRow } from "@/lib/wearables/merge";

/**
 * GET /api/training
 *
 * The last seven days of training, and whether the body is absorbing it.
 *
 *   -> { window: { days, endDate }, load, recovery }
 *
 * WHY IT IS NOT PART OF /api/trends. That route answers "how am I moving" from
 * check-ins and lab panels. This one reads three tables that route does not
 * touch, and it renders nothing at all for somebody who has never logged a
 * session. Folding it in would make every Trends load pay for a card most
 * users have not earned yet.
 *
 * WHY IT IS NOT UNDER /api/wearables EITHER. Its primary source is the check-in,
 * which everybody has. The device is an upgrade from reported to measured, not
 * the entry ticket.
 */

/**
 * The window the card describes. Seven days is what people mean by "this week"
 * and what the check-in trend already uses, so the two cards agree.
 */
const WINDOW_DAYS = 7;

/**
 * How far back to read. The recovery comparison needs the window before the
 * window, so a 7 day answer needs 14 days of history.
 */
const LOOKBACK_DAYS = WINDOW_DAYS * 2;

/**
 * The window ENDS TODAY, not at the most recent check-in.
 *
 * This is the opposite of what summarizeCheckins does, on purpose. That
 * function answers "what do your check-ins say", so anchoring to the newest one
 * is right: a missed day is absence of evidence, not a zero. This one answers
 * "how much did you train this week", where a day with no session IS the
 * answer. Anchoring to the last workout would quietly slide the window along
 * and report a fortnight off as a full training week.
 */
export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const userId = await resolveApprovedUserId(privyUserId);
  if (!userId) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  const endDate = todayUTC();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  try {
    const supabase = createSupabaseAdmin();
    const profileId = await getOrCreateSelfProfileId(userId);

    // Check-ins are keyed by profile; wearable rows by user. Both are read
    // together because the load reconciles them per day.
    const [checkinRes, workoutRes, metricRes] = await Promise.all([
      supabase
        .from("daily_checkins")
        .select("checkin_date, training_logged, exercises, energy_score, sleep_hours")
        .eq("profile_id", profileId)
        .gte("checkin_date", since)
        .order("checkin_date", { ascending: true }),
      supabase
        .from("wearable_workouts")
        .select("workout_date, started_at, ended_at, activity, strain, provider, auto_detected")
        .eq("user_id", userId)
        .gte("workout_date", since)
        .order("workout_date", { ascending: true }),
      supabase
        .from("wearable_daily_metrics")
        .select("provider, metric_date, metric, value")
        .eq("user_id", userId)
        .gte("metric_date", since)
        .order("metric_date", { ascending: true }),
    ]);

    // A failure on any one source degrades the card rather than emptying the
    // page. Somebody whose device sync is broken should still see the training
    // they logged by hand.
    for (const [name, res] of [
      ["check-ins", checkinRes],
      ["workouts", workoutRes],
      ["metrics", metricRes],
    ] as const) {
      if (res.error) console.error(`training read failed for ${name}:`, res.error);
    }

    const checkins = (checkinRes.data ?? []) as CheckinTrainingRow[];
    const workouts = (workoutRes.data ?? []) as WorkoutRow[];
    const byMetric = new Map(
      mergeMetrics((metricRes.data ?? []) as MetricRow[]).map((s) => [s.metric, s]),
    );

    return NextResponse.json({
      window: { days: WINDOW_DAYS, endDate },
      load: trainingLoad({ workouts, checkins }, endDate, WINDOW_DAYS),
      recovery: recoveryView(byMetric, checkins, endDate, WINDOW_DAYS),
    });
  } catch (err) {
    console.error("training read failed:", err);
    return NextResponse.json({ error: "Couldn't load your training" }, { status: 500 });
  }
}
