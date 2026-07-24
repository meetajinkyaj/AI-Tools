import { NextResponse } from "next/server";

import { todayUTC } from "@/lib/checkin";
import { RETEST_AFTER_DAYS } from "@/lib/future";
import { POINTS } from "@/lib/points";
import {
  type PushSub,
  retestDue,
  safeEqual,
  subscriptionsToNotify,
} from "@/lib/reminders";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/cron/due-reminders
 *
 * Returns the push subscriptions that should get a nudge now, in two lists:
 *   subscriptions — the daily check-in reminder (no check-in yet today);
 *   retest        — the once-per-cycle "your re-test window is open" push for
 *                   subscribers whose last panel is ~6 months old (payload is
 *                   built HERE so the points value stays in src/lib/points.ts).
 * A user due the (rarer, more valuable) re-test push skips the daily nudge that
 * day. Called by the scheduled sender (GitHub Actions) with the CRON_SECRET
 * bearer token; the web-push crypto runs in the sender (Node), not the Worker.
 * Both lists are idempotent per cycle: users are marked at hand-off
 * (reminder_sent daily; retest_reminder_sent per panel cycle), so backup or
 * manual runs can never double-ping.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Reminders not configured" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  if (!safeEqual(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdmin();
    const today = todayUTC();

    const { data: subs, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth, user_id");
    if (subsError) throw new Error(`push_subscriptions select failed: ${subsError.message}`);
    if (!subs || subs.length === 0) {
      return NextResponse.json({ date: today, count: 0, subscriptions: [], retest: null });
    }
    const subUserIds = [...new Set((subs as PushSub[]).map((s) => s.user_id))];

    const todayStart = `${today}T00:00:00Z`;
    const [
      { data: checkins, error: checkinError },
      { data: reminded, error: remindedError },
      { data: panels, error: panelsError },
      { data: retestReminded, error: retestRemindedError },
    ] = await Promise.all([
      supabase.from("daily_checkins").select("user_id").eq("checkin_date", today),
      // Idempotency: users already handed to a sender today are excluded, so
      // a backup/manual run can never double-ping anyone.
      supabase
        .from("events")
        .select("user_id")
        .eq("type", "reminder_sent")
        .gte("created_at", todayStart),
      supabase
        .from("biomarker_panels")
        .select("user_id, test_date, created_at")
        .in("user_id", subUserIds),
      supabase
        .from("events")
        .select("user_id, created_at")
        .eq("type", "retest_reminder_sent")
        .in("user_id", subUserIds)
        .order("created_at", { ascending: false }),
    ]);
    if (checkinError) throw new Error(`daily_checkins select failed: ${checkinError.message}`);
    if (remindedError) throw new Error(`events select failed: ${remindedError.message}`);
    if (panelsError) throw new Error(`biomarker_panels select failed: ${panelsError.message}`);
    if (retestRemindedError) {
      throw new Error(`retest events select failed: ${retestRemindedError.message}`);
    }

    // --- Panel-day: whose re-test window is open (once per panel cycle)? ---
    const lastPanelDateOf = new Map<string, string>();
    for (const p of panels ?? []) {
      const date = ((p.test_date as string | null) ?? (p.created_at as string)).slice(0, 10);
      const cur = lastPanelDateOf.get(p.user_id as string);
      if (!cur || date > cur) lastPanelDateOf.set(p.user_id as string, date);
    }
    const lastRetestReminderOf = new Map<string, string>();
    for (const r of retestReminded ?? []) {
      // ordered desc — first row per user is the latest reminder
      if (!lastRetestReminderOf.has(r.user_id as string)) {
        lastRetestReminderOf.set(r.user_id as string, r.created_at as string);
      }
    }
    const retestUserIds = new Set(
      subUserIds.filter((uid) => {
        const lastPanel = lastPanelDateOf.get(uid);
        if (!lastPanel) return false;
        return retestDue(
          lastPanel,
          lastRetestReminderOf.get(uid) ?? null,
          today,
          RETEST_AFTER_DAYS,
        );
      }),
    );
    const retestSubs = subscriptionsToNotify(
      (subs as PushSub[]).filter((s) => retestUserIds.has(s.user_id)),
      new Set(),
    );

    // Retest users get the rarer push instead of the daily nudge today.
    const skip = new Set([
      ...(checkins ?? []).map((c) => c.user_id as string),
      ...(reminded ?? []).map((r) => r.user_id as string),
      ...retestUserIds,
    ]);
    const dueSubs = (subs as PushSub[]).filter((s) => !skip.has(s.user_id));
    const subscriptions = subscriptionsToNotify(dueSubs, new Set());

    // Mark BEFORE the sender pushes (at-most-once): if the sender then fails,
    // users miss one nudge rather than risk being pinged twice.
    const dueUserIds = [...new Set(dueSubs.map((s) => s.user_id))];
    const marks = [
      ...dueUserIds.map((user_id) => ({ user_id, type: "reminder_sent" })),
      ...[...retestUserIds].map((user_id) => ({ user_id, type: "retest_reminder_sent" })),
    ];
    if (marks.length > 0) {
      await supabase.from("events").insert(marks);
    }

    return NextResponse.json({
      date: today,
      count: subscriptions.length,
      subscriptions,
      retest:
        retestSubs.length > 0
          ? {
              subscriptions: retestSubs,
              payload: {
                title: "Your re-test window is open",
                body: `It's been six months since your last panel. A re-test shows what your habits actually did — and earns +${POINTS.reTestUpload} iki points.`,
                url: "/",
                tag: "retest-due",
              },
            }
          : null,
    });
  } catch (err) {
    console.error("GET /api/cron/due-reminders failed:", err);
    return NextResponse.json({ error: "Failed to load reminders" }, { status: 500 });
  }
}
