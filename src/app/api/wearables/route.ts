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
import {
  FAMILY_BLURBS,
  FAMILY_LABELS,
  isMetricFamily,
  METRIC_FAMILIES,
  METRIC_FAMILY,
  type MetricFamily,
  rankedForFamily,
} from "@/lib/wearables/merge";
import { isMetricKey } from "@/lib/wearables/metrics";
import {
  loadSourcePreferences,
  pruneSourcePreferences,
  setSourcePreference,
} from "@/lib/wearables/source-preferences";
import { revokeAtVendor, syncUser, type ConnectionRow } from "@/lib/wearables/sync";
import type { ProviderId } from "@/lib/wearables/types";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET    /api/wearables         what's available and what this user has connected
 * POST   /api/wearables         { action: "sync" }, pull now
 * POST   /api/wearables         { action: "set-source", family, provider }
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

  /*
   * WHICH DEVICE ANSWERS FOR EACH FAMILY.
   *
   * `ranked` is the connected providers in the order the default would use, so
   * a member can see what "Automatic" resolves to rather than being told a
   * decision was made somewhere. With one device it is a list of one, which is
   * why nothing needs choosing until a second arrives.
   *
   * `preferred` is their explicit choice, or null. The two are kept apart on
   * purpose: a screen that showed only the outcome could not tell somebody
   * whether they had chosen it or we had.
   */
  const connectedIds = connections.map((c) => c.provider as ProviderId);
  const [prefs, { data: reported }] = await Promise.all([
    loadSourcePreferences(userId),
    /*
     * WHICH PROVIDERS HAVE ACTUALLY REPORTED, not which ones could.
     *
     * Every provider appears in every ranking, so "who is connected" would
     * offer a member with a Whoop and an Oura a choice of source for glucose,
     * which neither device measures. A picker for a number nobody produces is
     * worse than no picker: it implies the app has two answers and is asking
     * which to trust.
     *
     * Thirty days, so a device that has been on the charger for a week does
     * not drop out of its own picker.
     */
    supabase
      .from("wearable_daily_metrics")
      .select("provider, metric")
      .eq("user_id", userId)
      .gte(
        "metric_date",
        new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
      ),
  ]);

  const reportingByFamily = new Map<MetricFamily, Set<string>>();
  for (const row of reported ?? []) {
    const metric = row.metric as string;
    if (!isMetricKey(metric)) continue;
    const family = METRIC_FAMILY[metric];
    const set = reportingByFamily.get(family) ?? new Set<string>();
    set.add(row.provider as string);
    reportingByFamily.set(family, set);
  }

  const sources = METRIC_FAMILIES.map((family) => {
    const reporting = reportingByFamily.get(family) ?? new Set<string>();
    return {
      family,
      label: FAMILY_LABELS[family],
      blurb: FAMILY_BLURBS[family],
      preferred: prefs[family] ?? null,
      // Ranked order, filtered to devices that have actually sent something.
      // The client shows a picker only where there is more than one, which is
      // the only case where a choice means anything.
      ranked: rankedForFamily(family, connectedIds).filter((p) => reporting.has(p)),
    };
  });

  return NextResponse.json({
    enabled: true,
    sources,
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
  if (body.action === "sync") {
    const results = await syncUser(userId);
    return NextResponse.json({ ok: true, results });
  }

  /*
   * Choose which device answers for a family, or clear the choice.
   *
   * `provider: null` is a real request and not a malformed one: somebody who
   * decides they would rather we picked must be able to say so, and the only
   * way back to the default ranking is to delete the row.
   */
  if (body.action === "set-source") {
    const family = body.family;
    if (!isMetricFamily(family)) {
      return NextResponse.json({ error: "Unknown metric family" }, { status: 400 });
    }

    // Untrusted body: narrowed to a string before the provider check, so a
    // number or an object cannot reach `isProviderId`.
    const raw = body.provider;
    const provider = typeof raw === "string" ? raw : null;
    if (raw !== null && raw !== undefined && !isProviderId(provider ?? "")) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }

    /*
     * ONLY A DEVICE THEY ARE ACTUALLY CONNECTED TO.
     *
     * Without this a request could store a preference for a provider the
     * member has never connected. It would be inert in the merge, which never
     * matches it, and it would render on their settings screen as a device
     * they do not own. Rejected rather than ignored, because silently dropping
     * a write is how a UI ends up showing a choice that was never saved.
     */
    if (provider !== null) {
      const supabase = createSupabaseAdmin();
      const { data: existing } = await supabase
        .from("wearable_connections")
        .select("provider")
        .eq("user_id", userId)
        .eq("provider", provider)
        .not("access_token_enc", "is", null)
        .maybeSingle();
      if (!existing) {
        return NextResponse.json({ error: "That device is not connected" }, { status: 400 });
      }
    }

    try {
      await setSourcePreference(userId, family, provider);
    } catch (err) {
      console.error("set-source failed:", err);
      return NextResponse.json({ error: "Couldn't save that choice" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
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

  /*
   * Drop any source preference naming a device that is now gone.
   *
   * Harmless to the merge, which simply never matches it, and confusing on the
   * settings screen, which would offer a choice for a device that is no longer
   * listed. Best effort and after the delete: the disconnect is the thing the
   * member asked for, and tidying must never be able to fail it.
   */
  const { data: remaining } = await supabase
    .from("wearable_connections")
    .select("provider")
    .eq("user_id", userId);
  await pruneSourcePreferences(
    userId,
    (remaining ?? []).map((r) => r.provider as string),
  );

  return NextResponse.json({ ok: true });
}
