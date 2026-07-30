import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { mergeMetrics, type MetricRow } from "@/lib/wearables/merge";

/**
 * GET /api/wearables/metrics?days=30
 *
 * Every connected device's data for this user, already resolved into one series
 * per metric.
 *
 * THE MERGE HAPPENS HERE, not in the browser. Two reasons: the resolution rules
 * are the same ones Future You uses server-side, and duplicating them client
 * side is how the chart and the model start disagreeing about what your sleep
 * was. The client gets an answer, not the raw rows and a policy to apply.
 */
export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const userId = await resolveApprovedUserId(privyUserId);
  if (!userId) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  const raw = Number(new URL(request.url).searchParams.get("days"));
  // Bounded: this is one row per metric per day per provider, and an unbounded
  // window would let a client ask for everything on every page load.
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 180) : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("wearable_daily_metrics")
    .select("provider, metric_date, metric, value")
    .eq("user_id", userId)
    .gte("metric_date", since)
    .order("metric_date", { ascending: true });

  if (error) {
    console.error("wearable metrics read failed:", error);
    return NextResponse.json({ error: "Couldn't load device data" }, { status: 500 });
  }

  const series = mergeMetrics((data ?? []) as MetricRow[]);
  return NextResponse.json({ days, series });
}
