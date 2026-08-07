import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import { wearablesConfigured } from "@/lib/wearables/crypto";
import {
  configuredProviders,
  isProviderId,
  PROVIDER_IDS,
  PROVIDERS,
} from "@/lib/wearables/providers";
import { revokeAtVendor, syncUser, type ConnectionRow } from "@/lib/wearables/sync";
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
    .neq("status", "revoked")
    // A row with no access token is not a connection, whatever its status
    // says. Connect writes the row and its credentials in one statement now,
    // so this cannot be produced any more, but one such row exists in
    // production from before that fix and rows like it must read as "not
    // connected" rather than offering a Disconnect button for nothing.
    .not("access_token_enc", "is", null);

  const connections = data ?? [];

  /*
   * A CONNECTION ALWAYS GETS A ROW, even to a provider we have retired.
   *
   * The connect list is normally the configured providers, and `unavailable`
   * removes a provider from that. On its own that would strand anybody already
   * connected to a retired provider: no row, so no Disconnect button, so no way
   * to revoke a grant we can no longer sync. Retiring an integration must never
   * take away the exit.
   *
   * NO PROVIDER IS RETIRED TODAY. Fitbit's was, and the Google Health rewrite
   * cleared it. This path is therefore dormant, which is exactly when it will
   * be broken by an unrelated change, so `wearables.test.ts` exercises the gate
   * against a stand-in rather than leaving it untested until it is needed.
   */
  const listed = configuredProviders();
  const listedIds = new Set(listed.map((p) => p.id));
  const stranded = PROVIDER_IDS.map((id) => PROVIDERS[id]).filter(
    (p) => !listedIds.has(p.id) && connections.some((c) => c.provider === p.id),
  );

  return NextResponse.json({
    enabled: true,
    available: [...listed, ...stranded].map((p) => ({
      id: p.id,
      name: p.name,
      blurb: p.blurb,
      pushOnly: p.fetchRange === null,
      // Present and truthy means "you may leave, but you may not rejoin".
      retired: p.unavailable ?? null,
    })),
    connections,
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

  // TELL THE VENDOR FIRST, while we still hold the credentials: deleting the
  // row destroys them, and after that nobody can revoke anything.
  //
  // It is best effort and it never blocks the disconnect. Somebody who pressed
  // the button has to end up disconnected even when a vendor is down, and a
  // failed revoke that aborted the delete would leave them connected to an app
  // they just left, with live tokens on our side. That is the worse failure.
  //
  // Fitbit (Google), Whoop and Oura are asked, being the three whose revoke
  // endpoint is confirmed from their own documentation. Ultrahuman, Withings
  // and Garmin publish none, and a guessed URL 404s quietly while leaving us
  // believing we destroyed a grant we did not. For those three our copy of the
  // credentials is still destroyed, so we can never call them again; what
  // survives is the authorisation in the member's vendor account, which is why
  // reconnecting goes straight to consent with no sign-in. See
  // `docs/WEARABLES.md` for the current coverage.
  const { data: existing } = await supabase
    .from("wearable_connections")
    .select("id, user_id, provider, external_user_id, access_token_enc, refresh_token_enc, expires_at, status, failure_count")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (existing) {
    const outcome = await revokeAtVendor(existing as ConnectionRow);
    if (outcome !== "unsupported") {
      console.log(`wearable disconnect: vendor revoke for ${provider} was ${outcome}`);
    }
  }

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
