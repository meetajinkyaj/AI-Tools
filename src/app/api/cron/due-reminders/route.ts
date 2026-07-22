import { NextResponse } from "next/server";

import { todayUTC } from "@/lib/checkin";
import {
  type PushSub,
  safeEqual,
  subscriptionsToNotify,
} from "@/lib/reminders";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/cron/due-reminders
 *
 * Returns the push subscriptions that should get a daily check-in reminder now:
 * subscribers who have not checked in today. Called by the scheduled reminder
 * sender (GitHub Actions), authenticated with a shared CRON_SECRET bearer token.
 * The actual web-push send happens in the sender (Node), not here — the Workers
 * runtime isn't a good fit for the push-payload crypto.
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
      return NextResponse.json({ date: today, count: 0, subscriptions: [] });
    }

    const { data: checkins, error: checkinError } = await supabase
      .from("daily_checkins")
      .select("user_id")
      .eq("checkin_date", today);
    if (checkinError) throw new Error(`daily_checkins select failed: ${checkinError.message}`);

    const checkedIn = new Set((checkins ?? []).map((c) => c.user_id as string));
    const subscriptions = subscriptionsToNotify(subs as PushSub[], checkedIn);

    return NextResponse.json({ date: today, count: subscriptions.length, subscriptions });
  } catch (err) {
    console.error("GET /api/cron/due-reminders failed:", err);
    return NextResponse.json({ error: "Failed to load reminders" }, { status: 500 });
  }
}
