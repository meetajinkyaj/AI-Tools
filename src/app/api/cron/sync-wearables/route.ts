import { NextResponse } from "next/server";

import { safeEqual } from "@/lib/reminders";
import { wearablesConfigured } from "@/lib/wearables/crypto";
import { syncDue } from "@/lib/wearables/sync";

/**
 * GET /api/cron/sync-wearables
 *
 * The nightly sweep. Pulls the least-recently-synced active connections and
 * refreshes their last few days.
 *
 * WHY A WINDOW AND NOT "SINCE LAST SYNC". Every vendor here revises data after
 * the fact — a night's sleep score is finalised hours later, a watch that was
 * offline backfills days at once. Re-pulling a fixed recent window and relying
 * on the upsert to correct in place is both simpler and more accurate than
 * tracking a high-water mark that would silently miss every late arrival.
 *
 * Bounded per run so it cannot outgrow the Worker's CPU budget; whatever is not
 * reached this run is first in line the next, because the query orders by
 * `last_sync_at` ascending.
 *
 * Auth is the same CRON_SECRET bearer the reminders pipeline uses.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeEqual(token, secret)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (!wearablesConfigured()) {
    return NextResponse.json({ ok: true, skipped: "WEARABLE_TOKEN_KEY not set" });
  }

  const limitParam = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

  const results = await syncDue(limit);

  // Summarised rather than per-connection, so the response cannot become a way
  // to enumerate who has connected what.
  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    ok: true,
    processed: results.length,
    stored: results.reduce((n, r) => n + r.stored, 0),
    summary,
  });
}
