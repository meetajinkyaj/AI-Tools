import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import { matchDevice, MAX_SUGGESTION_LENGTH } from "@/lib/device-requests";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * "Which device should we add next?" — the user's own suggestions.
 *
 *   GET    /api/wearables/requests            this user's suggestions
 *   POST   /api/wearables/requests            add one   { device, notify? }
 *   PATCH  /api/wearables/requests            { notify } — applies to all
 *   DELETE /api/wearables/requests?key=…      remove one
 *
 * Deliberately NOT gated on `wearablesConfigured()`. Asking for a device has
 * to work before any vendor is live — that stretch is when the question is
 * most useful to us and the answer costs the user the least, because there is
 * nothing else on the screen for them to do.
 *
 * A person may suggest several devices; the unique index on
 * (user_id, device_key) is what stops one enthusiast reading as a crowd.
 */

/** Plenty for anyone with a genuine collection; a wall against a script. */
const MAX_PER_USER = 10;

async function requester(request: Request): Promise<string | null> {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) return null;
  return resolveApprovedUserId(privyUserId);
}

export async function GET(request: Request) {
  const userId = await requester(request);
  if (!userId) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("device_requests")
    .select("device_key, raw_text, notify, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(request: Request) {
  const userId = await requester(request);
  if (!userId) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const raw = typeof body.device === "string" ? body.device.trim() : "";
  const notify = body.notify === true;

  const match = matchDevice(raw);
  if (!match) {
    return NextResponse.json({ error: "Please enter a device name." }, { status: 400 });
  }

  const supabase = createSupabaseAdmin();

  // Count before inserting. The cap exists so one person cannot flood the
  // tally; re-submitting something they already asked for is an update, not a
  // new row, so it must not count against them.
  const { data: existing } = await supabase
    .from("device_requests")
    .select("device_key")
    .eq("user_id", userId);

  const already = (existing ?? []).some((r) => r.device_key === match.key);
  if (!already && (existing ?? []).length >= MAX_PER_USER) {
    return NextResponse.json(
      { error: `You can suggest up to ${MAX_PER_USER} devices.` },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("device_requests").upsert(
    {
      user_id: userId,
      device_key: match.key,
      raw_text: raw.slice(0, MAX_SUGGESTION_LENGTH),
      notify,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,device_key" },
  );
  if (error) {
    return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  }

  // The match is echoed back so the UI can say something true about the
  // device — that we already support it, or that we know what blocks it —
  // rather than a generic thank-you.
  return NextResponse.json({
    ok: true,
    device: { key: match.key, label: match.label, supported: match.supported, blocked: !!match.blocked },
  });
}

export async function PATCH(request: Request) {
  const userId = await requester(request);
  if (!userId) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (typeof body.notify !== "boolean") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // One checkbox for the whole list. Per-device opt-in is a finer distinction
  // than anyone wants to make about "email me when my devices land".
  const supabase = createSupabaseAdmin();
  await supabase
    .from("device_requests")
    .update({ notify: body.notify, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const userId = await requester(request);
  if (!userId) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  const key = new URL(request.url).searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  const supabase = createSupabaseAdmin();
  await supabase.from("device_requests").delete().eq("user_id", userId).eq("device_key", key);

  return NextResponse.json({ ok: true });
}
