import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import { displayStreak, todayUTC } from "@/lib/checkin";
import { getOrCreateSelfProfileId } from "@/lib/profiles";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import {
  type CheckinPoint,
  diffPanels,
  type MarkerReading,
  type PanelSnapshot,
  summarizeCheckins,
} from "@/lib/trends";

/**
 * Doctor-ready summary for the authenticated user's self profile — everything
 * the one-page PDF needs: who, the latest panel's out-of-range markers, movement
 * since baseline, and lifestyle context (check-ins + logged interventions).
 *
 *   GET /api/summary -> { profile, latestPanel, sinceBaseline, lifestyle, generatedAt }
 */

export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdmin();
    // Beta gate: unapproved users resolve to null (see app-user.ts).
    const userId = await resolveApprovedUserId(privyUserId);
    if (!userId) return NextResponse.json({ error: "User not found" }, { status: 409 });
    const profileId = await getOrCreateSelfProfileId(userId);

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, full_name, date_of_birth, biological_sex")
      .eq("id", profileId)
      .maybeSingle();

    // Panels (distinct time points) — most recent save per test date.
    const { data: panels } = await supabase
      .from("biomarker_panels")
      .select("id, test_date, lab_name, created_at")
      .eq("profile_id", profileId)
      .order("test_date", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .limit(12);
    type PanelRow = { id: string; test_date: string | null; lab_name: string | null; created_at: string };
    const dateKey = (p: PanelRow) => (p.test_date ?? p.created_at).slice(0, 10);
    const byDate = new Map<string, PanelRow>();
    for (const p of (panels ?? []) as PanelRow[]) byDate.set(dateKey(p), p);
    const distinct = [...byDate.values()];

    let latestPanel: unknown = null;
    let sinceBaseline: unknown = null;

    if (distinct.length >= 1) {
      const latestP = distinct[distinct.length - 1];
      const baselineP = distinct[0];
      const ids = distinct.length >= 2 ? [baselineP.id, latestP.id] : [latestP.id];
      const { data: rows } = await supabase
        .from("biomarker_readings")
        .select("panel_id, marker_key, marker_name, value, unit, flag, reference_range_low, reference_range_high")
        .in("panel_id", ids);
      const { data: catalog } = await supabase
        .from("biomarker_catalog")
        .select("marker_key, direction");
      const directionOf = new Map((catalog ?? []).map((c) => [c.marker_key, c.direction]));
      const forPanel = (pid: string): MarkerReading[] =>
        (rows ?? [])
          .filter((r) => r.panel_id === pid)
          .map((r) => ({
            marker_key: r.marker_key,
            marker_name: r.marker_name,
            value: r.value,
            flag: r.flag,
            direction: directionOf.get(r.marker_key),
            ref_low: r.reference_range_low,
            ref_high: r.reference_range_high,
          }));

      const latestRows = (rows ?? []).filter((r) => r.panel_id === latestP.id);
      latestPanel = {
        date: dateKey(latestP),
        lab: latestP.lab_name,
        totalCount: latestRows.length,
        // The clinician scans out-of-range first.
        flagged: latestRows
          .filter((r) => r.flag === "low" || r.flag === "high")
          .map((r) => ({
            name: r.marker_name,
            value: r.value,
            unit: r.unit,
            refLow: r.reference_range_low,
            refHigh: r.reference_range_high,
            flag: r.flag,
          })),
      };

      if (distinct.length >= 2) {
        const baseline: PanelSnapshot = { date: dateKey(baselineP), readings: forPanel(baselineP.id) };
        const latest: PanelSnapshot = { date: dateKey(latestP), readings: forPanel(latestP.id) };
        sinceBaseline = {
          baselineDate: baseline.date,
          latestDate: latest.date,
          deltas: diffPanels(baseline, latest)
            .filter((d) => d.delta != null && d.delta !== 0)
            .sort((a, b) => (a.improved === b.improved ? 0 : a.improved ? -1 : 1))
            .slice(0, 12),
        };
      }
    }

    // Lifestyle context.
    const { data: checkins } = await supabase
      .from("daily_checkins")
      .select("checkin_date, energy_score, sleep_hours, training_logged, streak_count")
      .eq("profile_id", profileId)
      .order("checkin_date", { ascending: false })
      .limit(30);
    const points = (checkins ?? []) as (CheckinPoint & { streak_count: number })[];
    const trend = summarizeCheckins(points);
    const streak = points[0]
      ? displayStreak(points[0].checkin_date, points[0].streak_count, todayUTC())
      : 0;

    const { data: interventions } = await supabase
      .from("intervention_log")
      .select("type, label, dose_note, started_at")
      .eq("profile_id", profileId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      profile: {
        name: profile?.display_name || profile?.full_name || "—",
        dob: profile?.date_of_birth ?? null,
        sex: profile?.biological_sex ?? null,
      },
      latestPanel,
      sinceBaseline,
      lifestyle: {
        avgEnergy: trend.avgEnergy,
        avgSleep: trend.avgSleep,
        checkinCount: trend.count,
        streak,
        interventions: interventions ?? [],
      },
    });
  } catch (err) {
    console.error("GET /api/summary failed:", err);
    return NextResponse.json({ error: "Failed to load summary" }, { status: 500 });
  }
}
