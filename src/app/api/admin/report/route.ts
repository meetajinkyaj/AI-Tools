import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { addDays, type UserRow } from "@/lib/analytics";
import { daysBetweenUTC, todayUTC } from "@/lib/checkin";
import { reportFilename, toCsv } from "@/lib/csv";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/admin/report, one row per member as CSV.
 *
 * WHY A FILE RATHER THAN MORE DASHBOARD. The Analytics tab answers the
 * questions we thought to ask. A spreadsheet answers the ones we did not: sort
 * by device, filter to people who connected and then went quiet, paste two
 * exports side by side a month apart. At this scale that is a better tool than
 * any chart we could build, and it costs one route.
 *
 * WHAT IS DELIBERATELY NOT IN IT:
 *
 *   - No tokens, encrypted or otherwise, and no `select *` anywhere below.
 *   - No health data. Not one biomarker value, not one reading. The counts are
 *     here (panels uploaded, check-ins made) because they measure engagement;
 *     the contents are not, because a member's cholesterol has no business in
 *     an operations spreadsheet, and a CSV in a Downloads folder is the least
 *     controlled place any of this data could sit.
 *
 * That second rule is the one to hold if somebody later asks for "just one
 * marker" in the export.
 *
 * Every field goes through `escapeCell`, which also neutralises spreadsheet
 * formulas: emails and invite codes are member-controlled and would otherwise
 * execute when an admin opens the file. See `src/lib/csv.ts`.
 */

/** How far back the activity columns look. */
const WINDOW_DAYS = 30;

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  try {
    const supabase = createSupabaseAdmin();
    const today = todayUTC();
    const since = `${addDays(today, -WINDOW_DAYS)}T00:00:00Z`;

    const [
      { data: users },
      { data: profiles },
      { data: checkins },
      { data: opens },
      { data: panels },
      { data: points },
      { data: devices },
    ] = await Promise.all([
      supabase
        .from("users")
        .select("id, email, created_at, access_status, referral_code, iki_score")
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      supabase.from("profiles").select("user_id").eq("relationship", "self"),
      supabase.from("daily_checkins").select("user_id, checkin_date, streak_count"),
      supabase
        .from("events")
        .select("user_id, created_at")
        .eq("type", "app_opened")
        .gte("created_at", since),
      supabase.from("biomarker_panels").select("user_id, test_date, created_at"),
      supabase.from("reward_points").select("user_id, points_balance"),
      supabase
        .from("wearable_connections")
        .select("user_id, provider, status, last_sync_at"),
    ]);

    const userRows = (users ?? []) as (UserRow & {
      email: string;
      access_status: string;
      referral_code: string | null;
      iki_score: number | null;
    })[];

    const onboarded = new Set((profiles ?? []).map((p) => p.user_id as string));

    // Activity = a check-in OR an app open, the same definition the dashboard
    // uses. Two definitions of "active" in one product is how two numbers that
    // should match stop matching.
    const activeDates = new Map<string, Set<string>>();
    const mark = (uid: string, date: string) => {
      const set = activeDates.get(uid) ?? new Set<string>();
      set.add(date);
      activeDates.set(uid, set);
    };

    const checkinDays = new Map<string, number>();
    const lastCheckin = new Map<string, { date: string; streak: number }>();
    for (const c of checkins ?? []) {
      const uid = c.user_id as string;
      const date = c.checkin_date as string;
      mark(uid, date);
      checkinDays.set(uid, (checkinDays.get(uid) ?? 0) + 1);
      const cur = lastCheckin.get(uid);
      if (!cur || date > cur.date) {
        lastCheckin.set(uid, { date, streak: c.streak_count as number });
      }
    }
    for (const o of opens ?? []) {
      mark(o.user_id as string, (o.created_at as string).slice(0, 10));
    }

    // Uploads and distinct test dates are different questions: re-saving one
    // report is two uploads and one point in time, and only the second is a
    // re-test. Reporting one number for both would make the re-test loop look
    // busier than it is.
    const panelUploads = new Map<string, number>();
    const panelDates = new Map<string, Set<string>>();
    for (const p of panels ?? []) {
      const uid = p.user_id as string;
      const date = ((p.test_date as string | null) ?? (p.created_at as string)).slice(0, 10);
      panelUploads.set(uid, (panelUploads.get(uid) ?? 0) + 1);
      const set = panelDates.get(uid) ?? new Set<string>();
      set.add(date);
      panelDates.set(uid, set);
    }

    const pointsByUser = new Map<string, number>();
    for (const p of points ?? []) {
      const uid = p.user_id as string;
      pointsByUser.set(uid, (pointsByUser.get(uid) ?? 0) + ((p.points_balance as number) ?? 0));
    }

    type Conn = { provider: string; status: string; last_sync_at: string | null };
    const connsByUser = new Map<string, Conn[]>();
    for (const d of devices ?? []) {
      const uid = d.user_id as string;
      const list = connsByUser.get(uid) ?? [];
      list.push({
        provider: d.provider as string,
        status: d.status as string,
        last_sync_at: (d.last_sync_at as string | null) ?? null,
      });
      connsByUser.set(uid, list);
    }
    for (const list of connsByUser.values()) {
      list.sort((a, b) => a.provider.localeCompare(b.provider));
    }

    const headers = [
      "email",
      "joined",
      "access_status",
      "onboarded",
      "invite_code",
      "devices_connected",
      "devices",
      "devices_syncing",
      "last_device_sync",
      "device_needs_reconnect",
      `active_days_${WINDOW_DAYS}d`,
      "last_active",
      "checkins_total",
      "current_streak",
      "last_checkin",
      "panel_uploads",
      "distinct_panel_dates",
      "points_balance",
      "iki_score",
      "days_since_signup",
    ];

    const rows = userRows.map((u) => {
      const conns = connsByUser.get(u.id) ?? [];
      const syncing = conns.filter((c) => c.last_sync_at != null);
      const lastSync = syncing
        .map((c) => c.last_sync_at as string)
        .sort()
        .pop();

      const dates = [...(activeDates.get(u.id) ?? [])].sort();
      const activeInWindow = dates.filter((d) => {
        const gap = daysBetweenUTC(d, today);
        return gap >= 0 && gap < WINDOW_DAYS;
      });
      const last = lastCheckin.get(u.id);

      return [
        u.email,
        u.created_at.slice(0, 10),
        u.access_status,
        onboarded.has(u.id) ? "yes" : "no",
        u.referral_code,
        conns.length,
        // Semicolons, not commas: a comma here would be correctly quoted and
        // still awkward to split on in a spreadsheet, which is what somebody
        // will want to do with this column.
        conns.map((c) => c.provider).join("; "),
        syncing.length,
        lastSync ? lastSync.slice(0, 10) : "",
        conns.some((c) => c.status === "expired") ? "yes" : "no",
        activeInWindow.length,
        dates.length > 0 ? dates[dates.length - 1] : "",
        checkinDays.get(u.id) ?? 0,
        last ? last.streak : 0,
        last ? last.date : "",
        panelUploads.get(u.id) ?? 0,
        panelDates.get(u.id)?.size ?? 0,
        pointsByUser.get(u.id) ?? 0,
        u.iki_score ?? 0,
        daysBetweenUTC(u.created_at.slice(0, 10), today),
      ];
    });

    const csv = toCsv(headers, rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${reportFilename("ikigaro-members", today)}"`,
        // This contains member emails. It must never sit in a shared cache.
        "Cache-Control": "no-store, private",
      },
    });
  } catch (err) {
    console.error("GET /api/admin/report failed:", err);
    return NextResponse.json({ error: "Failed to build the report" }, { status: 500 });
  }
}
