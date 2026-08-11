import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
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
    // Beta gate: unapproved users resolve to null (see app-user.ts).
    const userId = await resolveApprovedUserId(privyUserId);
    if (!userId) return NextResponse.json(emptyTrends());
    const profileId = await getOrCreateSelfProfileId(userId);

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
    // the same report (same test date) is one point in time, collapse duplicate
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

    /*
     * A NAME, NOT A COLUMN KEY.
     *
     * `points_transactions` stores `marker_key`, the canonical id: 'visceral_fat',
     * 'ldl_c', 'hs_crp'. The screen was printing it upper-cased, so the moment
     * somebody's marker actually improved, the reward that is supposed to be the
     * payoff of the whole loop read VISCERAL_FAT. Resolved here rather than in the
     * client because the client has no catalog, and inventing a name from the key
     * gets LDL_C wrong in a way nobody would accept from a health app.
     *
     * The catalog is the display name the report already uses, so the two screens
     * agree. `marker_key` is unique per (key, sex), so the same key can return two
     * rows with the same display name; last one wins and they match.
     */
    const bonusKeys = [...new Set((bonuses ?? []).map((b) => b.marker_key as string))];
    const markerNames: Record<string, string> = {};
    if (bonusKeys.length > 0) {
      const { data: names } = await supabase
        .from("biomarker_catalog")
        .select("marker_key, display_name")
        .in("marker_key", bonusKeys);
      for (const n of names ?? []) {
        markerNames[n.marker_key as string] = n.display_name as string;
      }
    }

    return NextResponse.json({
      checkin: {
        trend,
        series: checkinPoints.slice(0, 14).reverse(), // oldest→newest for sparkline
      },
      biomarker,
      bonuses: (bonuses ?? []).map((b) => ({
        ...b,
        // Null rather than the key when the catalog has no row for it: the
        // client can then fall back deliberately, instead of the server
        // guessing a name and the client being unable to tell.
        marker_name: markerNames[b.marker_key as string] ?? null,
      })),
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
