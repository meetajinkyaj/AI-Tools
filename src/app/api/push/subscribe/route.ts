import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveReportUser } from "@/lib/biomarker-report-data";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Web Push subscription store for daily check-in reminders.
 *
 *   POST   /api/push/subscribe  -> upsert this device's subscription
 *   DELETE /api/push/subscribe  -> remove it (opt out on this device)
 *
 * Stores only the push endpoint + keys + timezone. No notification content is
 * stored here; the sender builds it. Service-role DB access, Privy-authed.
 */

export async function POST(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const endpoint = typeof b.endpoint === "string" ? b.endpoint : null;
  const p256dh = typeof b.p256dh === "string" ? b.p256dh : null;
  const auth = typeof b.auth === "string" ? b.auth : null;
  const timezone = typeof b.timezone === "string" ? b.timezone.slice(0, 64) : null;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Missing subscription fields" }, { status: 400 });
  }

  try {
    const resolved = await resolveReportUser(privyUserId);
    if (!resolved) {
      return NextResponse.json({ error: "User not found" }, { status: 409 });
    }
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: resolved.userId,
        profile_id: resolved.profileId,
        endpoint,
        p256dh,
        auth,
        timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(`push_subscriptions upsert failed: ${error.message}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/push/subscribe failed:", err);
    return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const endpoint = (body as Record<string, unknown>).endpoint;
  if (typeof endpoint !== "string") {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }

  try {
    const resolved = await resolveReportUser(privyUserId);
    if (!resolved) return NextResponse.json({ ok: true });
    const supabase = createSupabaseAdmin();
    // Scope the delete to the caller so one user can't remove another's device.
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_id", resolved.userId);
    if (error) throw new Error(`push_subscriptions delete failed: ${error.message}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/push/subscribe failed:", err);
    return NextResponse.json({ error: "Failed to remove subscription" }, { status: 500 });
  }
}
