import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { mergeMetrics, type MetricRow } from "@/lib/wearables/merge";
import { METRIC_NOTES, METRICS, type MetricKey } from "@/lib/wearables/metrics";
import { isProviderId, PROVIDERS } from "@/lib/wearables/providers";
import { loadSourcePreferences } from "@/lib/wearables/source-preferences";
import type { ProviderId } from "@/lib/wearables/types";

/**
 * GET /api/wearables/device?days=7
 *
 * What each connected device actually sent, per device, unmerged.
 *
 * WHY THIS EXISTS ALONGSIDE /api/wearables/metrics. That route answers "what is
 * my sleep", which is the right question for a member and deliberately hides
 * which device supplied each night. This one answers a different question:
 * "what is my Whoop giving you". Until now the only way to answer it was to
 * open the database, which meant the person testing a new integration could not
 * check it from the app they were testing.
 *
 * IT REPORTS WHAT WE STORED, NOT WHAT WE SHOW. Every point carries `used`,
 * which says whether that number is the one Trends displays for that day. When
 * two devices report the same night, one of them loses the merge, and without
 * this flag a member comparing our screen against Whoop's own app sees a
 * mismatch with no explanation. This is the explanation.
 *
 * NO TOKENS, ever, and the columns are named rather than selected with a star,
 * for the same reason as the connections route: a credential column added later
 * must not start flowing to a browser because a query said `*`.
 */

/** Default and ceiling for the window. Small: this is unaggregated rows. */
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
/** Enough for a fortnight of hard training, and a hard bound on the payload. */
const MAX_WORKOUTS = 100;

interface DevicePoint {
  date: string;
  value: number;
  /** True when this is the number Trends shows for that day. */
  used: boolean;
}

export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const userId = await resolveApprovedUserId(privyUserId);
  if (!userId) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  const raw = Number(new URL(request.url).searchParams.get("days"));
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_DAYS) : DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  try {
    const supabase = createSupabaseAdmin();

    const [prefs, { data: connections }, { data: metricRows }, { data: workoutRows }] =
      await Promise.all([
        // The `used` flag below is the member's own merge rule applied back to
        // them. Merging here without their preferences would make this panel
        // contradict the card it exists to explain.
        loadSourcePreferences(userId),
        supabase
          .from("wearable_connections")
          .select("provider, status, last_sync_at")
          .eq("user_id", userId)
          .neq("status", "revoked")
          .not("access_token_enc", "is", null),
        supabase
          .from("wearable_daily_metrics")
          .select("provider, metric_date, metric, value")
          .eq("user_id", userId)
          .gte("metric_date", since)
          .order("metric_date", { ascending: true }),
        supabase
          .from("wearable_workouts")
          .select(
            "provider, workout_date, started_at, ended_at, activity, strain, calories, distance_m, avg_heart_rate, max_heart_rate, auto_detected",
          )
          .eq("user_id", userId)
          .gte("workout_date", since)
          .order("started_at", { ascending: false })
          .limit(MAX_WORKOUTS),
      ]);

    const rows = (metricRows ?? []) as MetricRow[];

    /*
     * THE MERGE IS RUN OVER EVERY PROVIDER, not just the one being described.
     * Whether Whoop's Tuesday is the number on screen depends entirely on what
     * Oura reported that Tuesday, so a per-provider query could not answer it.
     */
    const winner = new Map<string, ProviderId>();
    for (const s of mergeMetrics(rows, prefs)) {
      for (const p of s.points) winner.set(`${s.metric}:${p.date}`, p.source);
    }

    // provider -> metric -> points
    const byProvider = new Map<string, Map<MetricKey, DevicePoint[]>>();
    for (const row of rows) {
      const metric = row.metric as MetricKey;
      if (!(metric in METRICS)) continue;
      // Postgres numeric arrives as a string over PostgREST.
      const value = typeof row.value === "number" ? row.value : Number(row.value);
      if (!Number.isFinite(value)) continue;

      const metrics = byProvider.get(row.provider) ?? new Map<MetricKey, DevicePoint[]>();
      const points = metrics.get(metric) ?? [];
      points.push({
        date: row.metric_date,
        value,
        used: winner.get(`${metric}:${row.metric_date}`) === row.provider,
      });
      metrics.set(metric, points);
      byProvider.set(row.provider, metrics);
    }

    const workoutsByProvider = new Map<string, unknown[]>();
    for (const w of workoutRows ?? []) {
      const provider = w.provider as string;
      const list = workoutsByProvider.get(provider) ?? [];
      const startMs = Date.parse(w.started_at as string);
      const endMs = Date.parse(w.ended_at as string);
      list.push({
        date: w.workout_date,
        startedAt: w.started_at,
        // Null rather than zero when the timestamps are unusable: zero minutes
        // is a claim about the session, and "we cannot tell" is not that.
        minutes:
          Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
            ? Math.round((endMs - startMs) / 60_000)
            : null,
        activity: w.activity,
        strain: w.strain === null ? null : Number(w.strain),
        calories: w.calories,
        distanceM: w.distance_m,
        avgHeartRate: w.avg_heart_rate,
        maxHeartRate: w.max_heart_rate,
        autoDetected: w.auto_detected === true,
      });
      workoutsByProvider.set(provider, list);
    }

    // Ordered by the metric vocabulary rather than by whatever synced last, so
    // the panel does not reshuffle itself between visits.
    const order = Object.keys(METRICS) as MetricKey[];

    const devices = (connections ?? [])
      .filter((c) => isProviderId(c.provider as string))
      .map((c) => {
        const id = c.provider as ProviderId;
        const metrics = byProvider.get(id) ?? new Map<MetricKey, DevicePoint[]>();
        return {
          id,
          name: PROVIDERS[id].name,
          status: c.status,
          lastSyncAt: c.last_sync_at ?? null,
          metrics: [...metrics.entries()]
            .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
            .map(([metric, points]) => ({
              metric,
              label: METRICS[metric].label,
              unit: METRICS[metric].unit,
              precision: METRICS[metric].precision,
              // What the number counts, which is the commonest reason our
              // screen and a vendor's app disagree. See METRIC_NOTES.
              note: METRIC_NOTES[metric] ?? null,
              points: points.sort((a, b) => a.date.localeCompare(b.date)),
            })),
          workouts: workoutsByProvider.get(id) ?? [],
        };
      });

    return NextResponse.json({ days, devices });
  } catch (err) {
    console.error("wearable device read failed:", err);
    return NextResponse.json({ error: "Couldn't load your device data" }, { status: 500 });
  }
}
