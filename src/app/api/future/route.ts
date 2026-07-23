import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { todayUTC } from "@/lib/checkin";
import {
  computeHabitSignals,
  computeMomentum,
  markerOutlook,
  type MarkerPoint,
  MOMENTUM_WINDOW_DAYS,
  retestMilestone,
} from "@/lib/future";
import { getOrCreateSelfProfileId } from "@/lib/profiles";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import type { CheckinPoint } from "@/lib/trends";

/**
 * GET /api/future — the "Future You" six-month outlook.
 *
 * Panels are once-or-twice a year, so the response leads with habit momentum
 * (from daily check-ins); flagged markers get a directional outlook (habit_v1),
 * upgraded to a clamped linear projection (linear_v1) when a marker has 2+
 * distinct-date observations. Includes the re-test milestone and any active
 * interventions (the "running experiment" framing).
 */

const FLAGGED = new Set(["low", "high"]);

export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdmin();
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("privy_user_id", privyUserId)
      .maybeSingle();
    if (!user) return NextResponse.json(emptyFuture());
    const profileId = await getOrCreateSelfProfileId(user.id);

    // --- Habit momentum (the engine) ---
    const { data: checkins } = await supabase
      .from("daily_checkins")
      .select("checkin_date, energy_score, sleep_hours, training_logged")
      .eq("profile_id", profileId)
      .order("checkin_date", { ascending: false })
      .limit(MOMENTUM_WINDOW_DAYS * 2); // window + the window before, for the delta
    const momentum = computeMomentum(
      computeHabitSignals((checkins ?? []) as CheckinPoint[]),
    );

    // --- Panels, collapsed to distinct test dates (latest save per date) ---
    const { data: panels } = await supabase
      .from("biomarker_panels")
      .select("id, test_date, created_at")
      .eq("profile_id", profileId)
      .order("test_date", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });
    type PanelRow = { id: string; test_date: string | null; created_at: string };
    const dateKey = (p: PanelRow) => (p.test_date ?? p.created_at).slice(0, 10);
    const byDate = new Map<string, PanelRow>();
    for (const p of (panels ?? []) as PanelRow[]) byDate.set(dateKey(p), p);
    const distinct = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

    if (distinct.length === 0) {
      return NextResponse.json({ ...emptyFuture(), momentum });
    }

    const [latestDate, latestPanel] = distinct[distinct.length - 1];

    // --- Readings across all distinct panels → per-marker history ---
    const panelIds = distinct.map(([, p]) => p.id);
    const [{ data: rows }, { data: catalog }] = await Promise.all([
      supabase
        .from("biomarker_readings")
        .select(
          "panel_id, marker_key, marker_name, value, flag, reference_range_low, reference_range_high",
        )
        .in("panel_id", panelIds),
      supabase.from("biomarker_catalog").select("marker_key, direction"),
    ]);
    const directionOf = new Map((catalog ?? []).map((c) => [c.marker_key, c.direction]));
    const dateOfPanel = new Map(distinct.map(([d, p]) => [p.id, d]));

    const historyOf = new Map<string, MarkerPoint[]>();
    for (const r of rows ?? []) {
      if (r.value == null) continue;
      const date = dateOfPanel.get(r.panel_id);
      if (!date) continue;
      const list = historyOf.get(r.marker_key) ?? [];
      list.push({ date, value: r.value });
      historyOf.set(r.marker_key, list);
    }

    // --- Outlooks for the latest panel's flagged markers ---
    const latestRows = (rows ?? []).filter((r) => r.panel_id === latestPanel.id);
    const outlooks = latestRows
      .filter((r) => FLAGGED.has(r.flag))
      .map((r) =>
        markerOutlook(
          {
            marker_key: r.marker_key,
            marker_name: r.marker_name,
            value: r.value,
            flag: r.flag,
            direction: directionOf.get(r.marker_key),
            ref_low: r.reference_range_low,
            ref_high: r.reference_range_high,
          },
          historyOf.get(r.marker_key) ?? [],
          momentum,
        ),
      )
      .sort((a, b) => a.outlook.localeCompare(b.outlook)); // improving first

    // --- Active interventions (the running experiment) ---
    const { data: interventions } = await supabase
      .from("intervention_log")
      .select("id, type, label, started_at")
      .eq("profile_id", profileId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      momentum,
      markers: outlooks,
      inRangeCount: latestRows.filter((r) => !FLAGGED.has(r.flag)).length,
      retest: retestMilestone(latestDate, todayUTC()),
      panelCount: distinct.length,
      interventions: interventions ?? [],
    });
  } catch (err) {
    console.error("GET /api/future failed:", err);
    return NextResponse.json({ error: "Failed to load Future You" }, { status: 500 });
  }
}

function emptyFuture() {
  return {
    momentum: computeMomentum(computeHabitSignals([])),
    markers: [],
    inRangeCount: 0,
    retest: null,
    panelCount: 0,
    interventions: [],
  };
}
