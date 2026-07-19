import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
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
 * Trends for the authenticated user's self profile.
 *
 *   GET /api/trends -> {
 *     checkin: { trend, series },              // the frequent (daily) signal
 *     biomarker: { panelCount, baselineDate, latestDate, deltas },
 *     bonuses,                                  // recent outcome-verified earns
 *   }
 *
 * Lab panels are months apart, so biomarker deltas appear only with 2+ panels;
 * check-in trends have data from day one.
 */

const MAX_PANELS = 12;
const CHECKIN_LOOKBACK = 30;

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
    if (!user) return NextResponse.json(emptyTrends());
    const profileId = await getOrCreateSelfProfileId(user.id);

    // --- Check-in trend (energy / sleep) ---
    const { data: checkins } = await supabase
      .from("daily_checkins")
      .select("checkin_date, energy_score, sleep_hours, training_logged")
      .eq("profile_id", profileId)
      .order("checkin_date", { ascending: false })
      .limit(CHECKIN_LOOKBACK);
    const checkinPoints = (checkins ?? []) as CheckinPoint[];
    const trend = summarizeCheckins(checkinPoints);

    // --- Biomarker panels (baseline → latest delta) ---
    const { data: panels } = await supabase
      .from("biomarker_panels")
      .select("id, test_date, created_at")
      .eq("profile_id", profileId)
      .order("test_date", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .limit(MAX_PANELS);

    // A trend needs two distinct time points, not two panel rows. Re-uploading
    // the same report (same test date) is one point in time — collapse duplicate
    // dates to the most recent save so a repeated upload doesn't look like change.
    type PanelRow = { id: string; test_date: string | null; created_at: string };
    const dateKey = (p: PanelRow) => (p.test_date ?? p.created_at).slice(0, 10);
    const byDate = new Map<string, PanelRow>();
    for (const p of (panels ?? []) as PanelRow[]) byDate.set(dateKey(p), p); // ascending → keeps latest per date
    const distinctPanels = [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, p]) => p);

    let biomarker = {
      panelCount: distinctPanels.length, // distinct time points, not raw rows
      baselineDate: null as string | null,
      latestDate: null as string | null,
      deltas: [] as ReturnType<typeof diffPanels>,
    };

    if (distinctPanels.length >= 2) {
      const baselineP = distinctPanels[0];
      const latestP = distinctPanels[distinctPanels.length - 1];
      const { data: rows } = await supabase
        .from("biomarker_readings")
        .select(
          "panel_id, marker_key, marker_name, value, flag, reference_range_low, reference_range_high",
        )
        .in("panel_id", [baselineP.id, latestP.id]);
      // Direction ('lower_better'/…) drives whether a move counts as improvement.
      const { data: catalog } = await supabase
        .from("biomarker_catalog")
        .select("marker_key, direction");
      const directionOf = new Map(
        (catalog ?? []).map((c) => [c.marker_key, c.direction]),
      );
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
      const baseline: PanelSnapshot = {
        date: baselineP.test_date ?? baselineP.created_at,
        readings: forPanel(baselineP.id),
      };
      const latest: PanelSnapshot = {
        date: latestP.test_date ?? latestP.created_at,
        readings: forPanel(latestP.id),
      };
      // Surface movement first: improved, then still-flagged, then the rest.
      const deltas = diffPanels(baseline, latest).sort((a, b) => {
        const score = (d: (typeof deltas)[number]) =>
          d.improved ? 0 : d.latest_flag === "low" || d.latest_flag === "high" ? 1 : 2;
        return score(a) - score(b);
      });
      biomarker = {
        panelCount: distinctPanels.length,
        baselineDate: baseline.date.slice(0, 10),
        latestDate: latest.date.slice(0, 10),
        deltas,
      };
    }

    // --- Recent outcome-verified earns ---
    const { data: bonuses } = await supabase
      .from("points_transactions")
      .select("marker_key, delta_value, amount, verified_at")
      .eq("profile_id", profileId)
      .eq("reason", "outcome_bonus")
      .order("created_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      checkin: {
        trend,
        series: checkinPoints.slice(0, 14).reverse(), // oldest→newest for sparkline
      },
      biomarker,
      bonuses: bonuses ?? [],
    });
  } catch (err) {
    console.error("GET /api/trends failed:", err);
    return NextResponse.json({ error: "Failed to load trends" }, { status: 500 });
  }
}

function emptyTrends() {
  return {
    checkin: { trend: summarizeCheckins([]), series: [] },
    biomarker: { panelCount: 0, baselineDate: null, latestDate: null, deltas: [] },
    bonuses: [],
  };
}
