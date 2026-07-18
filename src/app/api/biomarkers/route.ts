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
import { createSupabaseAdmin } from "@/lib/supabase-admin";

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

    // The biomarker_panels.source CHECK allows 'manual' | 'pdf_upload' | 'lab_api'.
    // The client sends "pdf" for the extraction flow — map it to "pdf_upload".
    const rawSource = (rawBody as Record<string, unknown>).source;
    const source = rawSource === "pdf" || rawSource === "pdf_upload" ? "pdf_upload" : "manual";

    const { data: panel, error: panelError } = await supabase
      .from("biomarker_panels")
      .insert({
        user_id: resolved.userId,
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
        marker_key: r.marker_key,
        marker_name: entry.display_name,
        unit: entry.unit,
      };

      if (entry.result_kind === "qualitative") {
        return {
          ...base,
          value: null,
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
        value_text: null,
        result_kind: "numeric",
        reference_range_low: refLow,
        reference_range_high: refHigh,
        range_source: hasOverride ? "lab" : "catalog",
        flag: computeFlag(value, refLow, refHigh),
      };
    });

    // Derive markers (Non-HDL, ratios, eAG…) from the entered numeric values.
    const enteredNumeric = new Map<string, number>();
    for (const r of validation.value.readings) {
      if (r.value != null) {
        enteredNumeric.set(r.marker_key, canonicalizeCount(r.marker_key, r.value));
      }
    }
    const derivedRows = computeDerived(enteredNumeric)
      .filter((d) => byKey.has(d.marker_key))
      .map((d) => {
        const entry = byKey.get(d.marker_key)!;
        return {
          panel_id: panel.id,
          user_id: resolved.userId,
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

    return NextResponse.json({ panel, readings: readings ?? [] });
  } catch (err) {
    console.error("POST /api/biomarkers failed:", err);
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }
}
