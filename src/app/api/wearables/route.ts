import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import { wearablesConfigured } from "@/lib/wearables/crypto";
import { configuredProviders, isProviderId } from "@/lib/wearables/providers";
import { syncUser } from "@/lib/wearables/sync";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET    /api/wearables         what's available and what this user has connected
 * POST   /api/wearables         { action: "sync" }, pull now
 * DELETE /api/wearables?id=…    disconnect
 *
 * NOTE WHAT IS NOT HERE: no route ever returns a token, encrypted or otherwise.
 * The connection list is deliberately assembled field by field rather than
 * `select *`, so adding a column to `wearable_connections` later cannot
 * accidentally start serving credentials to the browser.
 */

export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const userId = await resolveApprovedUserId(privyUserId);
  if (!userId) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  if (!wearablesConfigured()) {
    // The feature is off rather than broken. The UI hides the section.
    return NextResponse.json({ available: [], connections: [], enabled: false });
  }

  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("wearable_connections")
    .select("id, provider, status, last_sync_at, connected_at")
    .eq("user_id", userId)
    .neq("status", "revoked");

  return NextResponse.json({
    enabled: true,
    available: configuredProviders().map((p) => ({
      id: p.id,
      name: p.name,
      blurb: p.blurb,
      pushOnly: p.fetchRange === null,
    })),
    connections: data ?? [],
  });
}

export async function POST(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const userId = await resolveApprovedUserId(privyUserId);
  if (!userId) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (body.action !== "sync") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const results = await syncUser(userId);
  return NextResponse.json({ ok: true, results });
}

export async function DELETE(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const userId = await resolveApprovedUserId(privyUserId);
  if (!userId) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  const provider = new URL(request.url).searchParams.get("provider");
  if (!provider || !isProviderId(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const supabase = createSupabaseAdmin();

  // Delete the grant outright rather than flagging it: keeping a row that
  // still holds a live refresh token for someone who asked us to disconnect is
  // the wrong default, and the metrics they already synced are unaffected.
  const { error } = await supabase
    .from("wearable_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);

  if (error) {
    console.error("wearable disconnect failed:", error);
    return NextResponse.json({ error: "Couldn't disconnect" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
