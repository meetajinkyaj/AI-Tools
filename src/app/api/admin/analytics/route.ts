import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import {
  addDays,
  computeActive,
  computeFunnel,
  computeRetention,
  computeStreakBuckets,
  dailySeries,
  type UserRow,
} from "@/lib/analytics";
import { todayUTC } from "@/lib/checkin";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/admin/analytics — the beta metrics the checklist says to watch:
 * funnel (signups → onboarded → first panel → re-test), D1/D7/D30 retention,
 * DAU/WAU/MAU, live-streak distribution, the 14-day check-in series, push
 * opt-ins, redemptions, and recent client errors. Aggregated in memory —
 * fine at beta scale. Admin-only.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  try {
    const supabase = createSupabaseAdmin();
    const today = todayUTC();
    const monthAgo = `${addDays(today, -35)}T00:00:00Z`;
    const weekAgo = `${addDays(today, -7)}T00:00:00Z`;

    const [
      { data: users },
      { data: profiles },
      { data: panels },
      { data: checkins },
      { data: opens },
      { count: pushCount },
      { count: redemptionCount },
      { data: recentErrors },
      { count: errorCount7d },
    ] = await Promise.all([
      supabase.from("users").select("id, created_at").is("deleted_at", null),
      supabase
        .from("profiles")
        .select("user_id")
        .eq("relationship", "self")
        .not("full_name", "is", null),
      supabase.from("biomarker_panels").select("user_id, test_date, created_at"),
      supabase.from("daily_checkins").select("user_id, checkin_date, streak_count"),
      supabase
        .from("events")
        .select("user_id, created_at")
        .eq("type", "app_opened")
        .gte("created_at", monthAgo),
      supabase.from("push_subscriptions").select("id", { count: "exact", head: true }),
      supabase
        .from("redemption_transactions")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("client_errors")
        .select("id, user_id, message, url, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("client_errors")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo),
    ]);

    const userRows = (users ?? []) as UserRow[];
    const onboarded = new Set((profiles ?? []).map((p) => p.user_id as string));

    // Distinct panel DATES per user (a re-saved duplicate isn't a re-test).
    const panelDatesByUser = new Map<string, Set<string>>();
    for (const p of panels ?? []) {
      const date = ((p.test_date as string | null) ?? (p.created_at as string)).slice(0, 10);
      const set = panelDatesByUser.get(p.user_id as string) ?? new Set<string>();
      set.add(date);
      panelDatesByUser.set(p.user_id as string, set);
    }

    // Activity = check-in dates ∪ app_opened dates.
    const activeDatesByUser = new Map<string, Set<string>>();
    const markActive = (uid: string, date: string) => {
      const set = activeDatesByUser.get(uid) ?? new Set<string>();
      set.add(date);
      activeDatesByUser.set(uid, set);
    };
    const latestCheckinByUser = new Map<string, { date: string; streak: number }>();
    const checkinDates: string[] = [];
    for (const c of checkins ?? []) {
      const uid = c.user_id as string;
      const date = c.checkin_date as string;
      checkinDates.push(date);
      markActive(uid, date);
      const cur = latestCheckinByUser.get(uid);
      if (!cur || date > cur.date) {
        latestCheckinByUser.set(uid, { date, streak: c.streak_count as number });
      }
    }
    for (const o of opens ?? []) {
      markActive(o.user_id as string, (o.created_at as string).slice(0, 10));
    }

    return NextResponse.json({
      funnel: computeFunnel(userRows, onboarded, panelDatesByUser),
      retention: computeRetention(userRows, activeDatesByUser, today),
      active: computeActive(activeDatesByUser, today),
      streaks: computeStreakBuckets(latestCheckinByUser, today),
      checkinSeries: dailySeries(checkinDates, today),
      pushOptIns: pushCount ?? 0,
      redemptions: redemptionCount ?? 0,
      errors: { recent: recentErrors ?? [], count7d: errorCount7d ?? 0 },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("GET /api/admin/analytics failed:", err);
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
  }
}
