import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/admin/users — a roster with each user's key engagement signals:
 * points balance, panels uploaded, and last check-in / streak. Aggregated in
 * memory (fine at beta scale). Admin-only.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const supabase = createSupabaseAdmin();
  const [{ data: users }, { data: points }, { data: panels }, { data: checkins }] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, email, created_at, deleted_at")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("reward_points").select("user_id, points_balance"),
      supabase.from("biomarker_panels").select("user_id"),
      supabase.from("daily_checkins").select("user_id, checkin_date, streak_count"),
    ]);

  const pointsByUser = new Map<string, number>();
  for (const p of points ?? []) {
    const r = p as { user_id: string; points_balance: number };
    pointsByUser.set(r.user_id, (pointsByUser.get(r.user_id) ?? 0) + (r.points_balance ?? 0));
  }
  const panelsByUser = new Map<string, number>();
  for (const p of panels ?? []) {
    const uid = (p as { user_id: string }).user_id;
    panelsByUser.set(uid, (panelsByUser.get(uid) ?? 0) + 1);
  }
  // Latest check-in per user (by date).
  const lastCheckin = new Map<string, { date: string; streak: number }>();
  for (const c of checkins ?? []) {
    const r = c as { user_id: string; checkin_date: string; streak_count: number };
    const cur = lastCheckin.get(r.user_id);
    if (!cur || r.checkin_date > cur.date) {
      lastCheckin.set(r.user_id, { date: r.checkin_date, streak: r.streak_count });
    }
  }

  const roster = (users ?? []).map((u) => {
    const last = lastCheckin.get(u.id);
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      deleted: u.deleted_at != null,
      points: pointsByUser.get(u.id) ?? 0,
      panels: panelsByUser.get(u.id) ?? 0,
      last_checkin: last?.date ?? null,
      streak: last?.streak ?? 0,
    };
  });

  return NextResponse.json({ users: roster, count: roster.length });
}
