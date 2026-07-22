import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveReportUser } from "@/lib/biomarker-report-data";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * POST /api/redemptions/click — log an affiliate product click (best-effort,
 * for attribution). Never blocks the user's click-through; failures are ignored.
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
  const itemId = (body as Record<string, unknown>).item_id;
  if (typeof itemId !== "string") {
    return NextResponse.json({ error: "Missing item_id" }, { status: 400 });
  }

  try {
    const resolved = await resolveReportUser(privyUserId);
    if (resolved) {
      const supabase = createSupabaseAdmin();
      await supabase.from("events").insert({
        user_id: resolved.userId,
        type: "affiliate_click",
        metadata: { item_id: itemId },
      });
    }
  } catch (err) {
    console.error("Affiliate click log failed (non-fatal):", err);
  }
  // Always OK — click tracking must never block the user.
  return NextResponse.json({ ok: true });
}
