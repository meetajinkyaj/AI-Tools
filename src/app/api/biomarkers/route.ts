import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import {
  canonicalizeCount,
  computeDerived,
  computeFlag,
  qualitativeFlag,
  validatePanelInput,
} from "@/lib/biomarkers";
import {
  loadReportCatalog,
  resolveReportUser,
} from "@/lib/biomarker-report-data";
import {
  POINTS,
  POINTS_REASON,
  REFERRAL_PANEL_WINDOW_DAYS,
  isReplayUpload,
  panelContentSignature,
  uploadEarn,
  type SignatureReading,
} from "@/lib/points";
import { awardReferralMilestone } from "@/lib/referral-award";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import {
  computeOutcomeAwards,
  type MarkerReading,
  type OutcomeAward,
  type PanelSnapshot,
} from "@/lib/trends";

/** A saved reading row with the fields the reward engine needs. */
interface ReadingRowLite {
  marker_key: string;
  marker_name?: string | null;
  value: number | null;
  flag: string;
  reference_range_low: number | null;
  reference_range_high: number | null;
}

/** A points_transactions row (earn). */
type PointsTxn = Record<string, unknown>;

/** Points txn for uploading this panel (see uploadEarn for the economy rules). */
function computeUploadTxn(
  userId: string,
  profileId: string,
  newPanel: { id: string; test_date: string | null },
  priorPanels: { test_date: string | null }[],
): PointsTxn | null {
  const earn = uploadEarn(
    newPanel.test_date,
    priorPanels.map((p) => p.test_date),
  );
  if (!earn) return null;
  return {
    user_id: userId,
    profile_id: profileId,
    type: "earn",
    reference_id: newPanel.id,
    source_panel_id: newPanel.id,
    amount: earn.amount,
    reason: earn.reason,
  };
}

/**
 * If a panel with this exact content signature already exists for the profile,
 * return it (with its full readings). Used to avoid inserting a duplicate panel
 * row when the same report is saved again — the app inserts a new row on every
 * save, so without this an identical re-upload leaves a duplicate baseline row.
 */
async function findDuplicatePanel(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  profileId: string,
  signature: string,
): Promise<{ panel: Record<string, unknown>; readings: Record<string, unknown>[] } | null> {
  const { data: panels } = await supabase
    .from("biomarker_panels")
    .select("id")
    .eq("profile_id", profileId);
  if (!panels || panels.length === 0) return null;

  const { data: readings } = await supabase
    .from("biomarker_readings")
    .select("panel_id, marker_key, value, value_text")
    .in(
      "panel_id",
      panels.map((p) => p.id),
    );
  if (!readings || readings.length === 0) return null;

  const byPanel = new Map<string, SignatureReading[]>();
  for (const r of readings as (SignatureReading & { panel_id: string })[]) {
    const rows = byPanel.get(r.panel_id) ?? [];
    rows.push(r);
    byPanel.set(r.panel_id, rows);
  }
  let dupId: string | null = null;
  for (const [pid, rows] of byPanel) {
    if (panelContentSignature(rows) === signature) {
      dupId = pid;
      break;
    }
  }
  if (!dupId) return null;

  const { data: panel } = await supabase
    .from("biomarker_panels")
    .select("*")
    .eq("id", dupId)
    .single();
  if (!panel) return null;
  const { data: fullReadings } = await supabase
    .from("biomarker_readings")
    .select("*")
    .eq("panel_id", dupId);
  return { panel, readings: fullReadings ?? [] };
}

/**
 * Award panel points on save: the upload earn (first / re-test) plus any
 * outcome-verified improvement, credited to the balance in one update. Best-effort
 * — never fails the save. Returns the outcome bonuses and total points awarded.
 */
async function awardPanelPoints(
  profileId: string,
  userId: string,
  newPanel: { id: string; test_date: string | null; created_at: string },
  newReadings: ReadingRowLite[],
  directionOf: Map<string, string>,
): Promise<{ bonuses: OutcomeAward[]; pointsAwarded: number }> {
  const toSnapshot = (rows: ReadingRowLite[]): MarkerReading[] =>
    rows.map((r) => ({
      marker_key: r.marker_key,
      marker_name: r.marker_name ?? null,
      value: r.value,
      flag: r.flag,
      direction: directionOf.get(r.marker_key),
      ref_low: r.reference_range_low,
      ref_high: r.reference_range_high,
    }));

  try {
    const supabase = createSupabaseAdmin();
    const { data: priorPanels } = await supabase
      .from("biomarker_panels")
      .select("id, test_date, created_at")
      .eq("profile_id", profileId)
      .neq("id", newPanel.id)
      .order("test_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    const prior = priorPanels ?? [];

    // Anti-farm: the same report re-uploaded earns nothing, even if its
    // (user-editable) test date was changed. The test date can't be trusted as
    // the identity of a report, so match on content: if any prior panel has the
    // exact same marker/value set, this is a replay — award zero and stop.
    const priorIds = prior.map((p) => p.id);
    if (priorIds.length > 0) {
      const { data: priorReadings } = await supabase
        .from("biomarker_readings")
        .select("panel_id, marker_key, value, value_text")
        .in("panel_id", priorIds);
      if (priorReadings && priorReadings.length > 0) {
        const byPanel = new Map<string, SignatureReading[]>();
        for (const r of priorReadings as (SignatureReading & { panel_id: string })[]) {
          const rows = byPanel.get(r.panel_id) ?? [];
          rows.push(r);
          byPanel.set(r.panel_id, rows);
        }
        const newSignature = panelContentSignature(newReadings);
        const priorSignatures = [...byPanel.values()].map(panelContentSignature);
        if (isReplayUpload(newSignature, priorSignatures)) {
          return { bonuses: [], pointsAwarded: 0 };
        }
      }
    }

    const txns: PointsTxn[] = [];

    // 1. Upload earn.
    const uploadTxn = computeUploadTxn(userId, profileId, newPanel, prior);
    if (uploadTxn) txns.push(uploadTxn);

    // Referral tier 3: the friend's FIRST panel, within the signup window,
    // pays their referrer. Once ever (ledger-checked); best-effort.
    if (prior.length === 0) {
      await awardReferralMilestone(userId, POINTS_REASON.referralPanel, POINTS.referralPanel, {
        withinDaysOfSignup: REFERRAL_PANEL_WINDOW_DAYS,
      });
    }

    // 2. Outcome-verified improvement vs the previous panel.
    const bonuses: OutcomeAward[] = [];
    const prevPanel = prior[0];
    if (prevPanel) {
      const { data: prevReadings } = await supabase
        .from("biomarker_readings")
        .select("marker_key, marker_name, value, flag, reference_range_low, reference_range_high")
        .eq("panel_id", prevPanel.id);
      if (prevReadings && prevReadings.length > 0) {
        const previous: PanelSnapshot = {
          date: prevPanel.test_date ?? prevPanel.created_at,
          readings: toSnapshot(prevReadings as ReadingRowLite[]),
        };
        const latest: PanelSnapshot = {
          date: newPanel.test_date ?? newPanel.created_at,
          readings: toSnapshot(newReadings),
        };
        for (const a of computeOutcomeAwards(previous, latest)) {
          bonuses.push(a);
          txns.push({
            user_id: userId,
            profile_id: profileId,
            type: "earn",
            amount: a.points,
            reason: POINTS_REASON.outcomeBonus,
            reference_id: newPanel.id,
            source_panel_id: newPanel.id,
            marker_key: a.marker_key,
            delta_value: a.delta,
            verified_at: new Date().toISOString(),
          });
        }
      }
    }

    if (txns.length === 0) return { bonuses, pointsAwarded: 0 };

    // Credit once.
    const earned = txns.reduce((sum, t) => sum + (t.amount as number), 0);
    const { data: balanceRow } = await supabase
      .from("reward_points")
      .select("points_balance")
      .eq("profile_id", profileId)
      .maybeSingle();
    const priorBalance = balanceRow?.points_balance ?? 0;
    await supabase
      .from("reward_points")
      .upsert(
        { user_id: userId, profile_id: profileId, points_balance: priorBalance + earned },
        { onConflict: "profile_id" },
      );
    await supabase.from("points_transactions").insert(txns);

    return { bonuses, pointsAwarded: earned };
  } catch (err) {
    console.error("Panel points awarding failed (non-fatal):", err);
    return { bonuses: [], pointsAwarded: 0 };
  }
}

/**
 * Baseline Biomarker Report for the authenticated user.
 *
 *   GET  /api/biomarkers  -> { catalog, latestPanel }
 *   POST /api/biomarkers  -> { panel, readings }   (create a panel, flags computed)
 *
 * The catalog is returned deduped for the user's biological sex. On POST, each
 * entered value is flagged (in_range / low / high) against that sex-appropriate
 * reference range, and the range used is snapshotted onto the reading. DB access
 * uses the service-role key.
 */

export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const resolved = await resolveReportUser(privyUserId);
    if (!resolved) {
      return NextResponse.json({ catalog: [], latestPanel: null });
    }

    const supabase = createSupabaseAdmin();
    const catalog = await loadReportCatalog(resolved.sex);

    const { data: panel, error: panelError } = await supabase
      .from("biomarker_panels")
      .select("*")
      .eq("user_id", resolved.userId)
      .order("test_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (panelError) throw new Error(`biomarker_panels select failed: ${panelError.message}`);

    let latestPanel = null;
    if (panel) {
      const { data: readings, error: readingsError } = await supabase
        .from("biomarker_readings")
        .select("*")
        .eq("panel_id", panel.id);
      if (readingsError) {
        throw new Error(`biomarker_readings select failed: ${readingsError.message}`);
      }
      latestPanel = { panel, readings: readings ?? [] };
    }

    return NextResponse.json({ catalog, latestPanel });
  } catch (err) {
    console.error("GET /api/biomarkers failed:", err);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const validation = validatePanelInput(rawBody);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const resolved = await resolveReportUser(privyUserId);
    if (!resolved) {
      return NextResponse.json({ error: "User not found" }, { status: 409 });
    }

    const supabase = createSupabaseAdmin();
    const catalog = await loadReportCatalog(resolved.sex);
    const byKey = new Map(catalog.map((e) => [e.marker_key, e]));

    // Reject unknown markers up front.
    for (const r of validation.value.readings) {
      if (!byKey.has(r.marker_key)) {
        return NextResponse.json(
          { error: `Unknown marker: ${r.marker_key}` },
          { status: 400 },
        );
      }
    }

    // Canonicalized numeric values + derived markers, computed once up front so
    // both the dedup check below and the reading rows use the same values.
    const enteredNumeric = new Map<string, number>();
    for (const r of validation.value.readings) {
      if (r.value != null) {
        enteredNumeric.set(r.marker_key, canonicalizeCount(r.marker_key, r.value));
      }
    }
    const derived = computeDerived(enteredNumeric).filter((d) => byKey.has(d.marker_key));

    // Dedup: the app inserts a panel row on every save, so re-saving the same
    // report would leave duplicate panel rows (points are deduped separately,
    // but the row was not). If this exact content already exists for the
    // profile, return that panel instead of inserting a duplicate. A same-date
    // *correction* (genuinely different values) has a different signature and
    // still saves — only exact replays are collapsed.
    const newSignature = panelContentSignature([
      ...validation.value.readings.map((r): SignatureReading =>
        byKey.get(r.marker_key)!.result_kind === "qualitative"
          ? { marker_key: r.marker_key, value: null, value_text: r.value_text ?? null }
          : { marker_key: r.marker_key, value: canonicalizeCount(r.marker_key, r.value as number) },
      ),
      ...derived.map((d): SignatureReading => ({ marker_key: d.marker_key, value: d.value })),
    ]);
    const duplicate = await findDuplicatePanel(
      supabase,
      resolved.profileId,
      newSignature,
    );
    if (duplicate) {
      return NextResponse.json({
        panel: duplicate.panel,
        readings: duplicate.readings,
        bonuses: [],
        pointsAwarded: 0,
        duplicate: true,
      });
    }

    // The biomarker_panels.source CHECK allows 'manual' | 'pdf_upload' | 'lab_api'.
    // The client sends "pdf" for the extraction flow — map it to "pdf_upload".
    const rawSource = (rawBody as Record<string, unknown>).source;
    const source = rawSource === "pdf" || rawSource === "pdf_upload" ? "pdf_upload" : "manual";

    const { data: panel, error: panelError } = await supabase
      .from("biomarker_panels")
      .insert({
        user_id: resolved.userId,
        profile_id: resolved.profileId,
        source,
        test_date: validation.value.test_date,
        lab_name: validation.value.lab_name,
      })
      .select("*")
      .single();
    if (panelError || !panel) {
      throw new Error(`biomarker_panels insert failed: ${panelError?.message ?? "no row"}`);
    }

    const readingRows = validation.value.readings.map((r) => {
      const entry = byKey.get(r.marker_key)!;
      const base = {
        panel_id: panel.id,
        user_id: resolved.userId,
        profile_id: resolved.profileId,
        marker_key: r.marker_key,
        marker_name: entry.display_name,
        unit: entry.unit,
        // Raw-as-printed provenance (stored, never used for flagging).
        unit_raw: r.unit_raw,
        lab_reference_low: r.lab_reference_low,
        lab_reference_high: r.lab_reference_high,
      };

      if (entry.result_kind === "qualitative") {
        return {
          ...base,
          value: null,
          value_raw: null,
          value_text: r.value_text,
          result_kind: "qualitative",
          reference_range_low: null,
          reference_range_high: null,
          range_source: "catalog",
          flag: qualitativeFlag(r.value_text ?? "", entry.normal_text),
        };
      }

      // Numeric — canonicalize raw cell-count units (idempotent) and use a
      // lab-provided range override when given.
      const value = canonicalizeCount(r.marker_key, r.value as number);
      const hasOverride = r.ref_low != null || r.ref_high != null;
      const refLow = hasOverride ? r.ref_low : entry.ref_low;
      const refHigh = hasOverride ? r.ref_high : entry.ref_high;
      return {
        ...base,
        value,
        value_raw: r.value_raw ?? (r.value as number),
        value_text: null,
        result_kind: "numeric",
        reference_range_low: refLow,
        reference_range_high: refHigh,
        range_source: hasOverride ? "lab" : "catalog",
        flag: computeFlag(value, refLow, refHigh),
      };
    });

    // Derived markers (Non-HDL, ratios, eAG…) — computed up front, mapped here.
    const derivedRows = derived.map((d) => {
      const entry = byKey.get(d.marker_key)!;
      return {
        panel_id: panel.id,
        user_id: resolved.userId,
        profile_id: resolved.profileId,
        marker_key: d.marker_key,
        marker_name: entry.display_name,
        unit: entry.unit,
        value: d.value,
        value_text: null,
        result_kind: "numeric",
        reference_range_low: entry.ref_low,
        reference_range_high: entry.ref_high,
        range_source: "catalog",
        flag: computeFlag(d.value, entry.ref_low, entry.ref_high),
      };
    });

    const { data: readings, error: readingsError } = await supabase
      .from("biomarker_readings")
      .insert([...readingRows, ...derivedRows])
      .select("*");
    if (readingsError) {
      throw new Error(`biomarker_readings insert failed: ${readingsError.message}`);
    }

    // Best-effort timeline event.
    await supabase.from("events").insert({
      user_id: resolved.userId,
      type: "biomarker_panel_created",
      metadata: {
        panel_id: panel.id,
        marker_count: readingRows.length + derivedRows.length,
      },
    });

    // Award upload + outcome points (best-effort).
    const directionOf = new Map(catalog.map((e) => [e.marker_key, e.direction]));
    const { bonuses, pointsAwarded } = await awardPanelPoints(
      resolved.profileId,
      resolved.userId,
      panel,
      (readings ?? []) as ReadingRowLite[],
      directionOf,
    );

    return NextResponse.json({ panel, readings: readings ?? [], bonuses, pointsAwarded });
  } catch (err) {
    console.error("POST /api/biomarkers failed:", err);
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }
}
