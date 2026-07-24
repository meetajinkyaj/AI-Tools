import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { todayUTC } from "@/lib/checkin";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * POST /api/telemetry — the app's lightweight beacon.
 *
 *   { kind: "open" }                          -> one app_opened event per UTC day
 *                                                (authed only; powers retention)
 *   { kind: "error", message, stack?, url? }  -> client_errors row; auth OPTIONAL,
 *                                                because pre-auth white-screens are
 *                                                exactly the crashes worth seeing.
 *
 * Fire-and-forget by design: responds 200 even when nothing is written, so a
 * telemetry hiccup can never surface as a user-facing failure. Unauthed error
 * payloads are hard-capped (sizes below) — acceptable surface for beta scale.
 */

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_URL = 300;
const MAX_UA = 300;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true }); // malformed beacons are dropped, not errored
  }

  try {
    const privyUserId = await getPrivyUserId(request);
    const supabase = createSupabaseAdmin();

    if (body.kind === "open") {
      if (!privyUserId) return NextResponse.json({ ok: true });
      // Only approved users count toward DAU/retention — waitlisted logins
      // seeing the waitlist screen aren't product activity.
      const { data: user } = await supabase
        .from("users")
        .select("id, access_status")
        .eq("privy_user_id", privyUserId)
        .maybeSingle();
      if (!user || user.access_status !== "approved") {
        return NextResponse.json({ ok: true });
      }

      // One app_opened per UTC day keeps retention queries trivial.
      const todayStart = `${todayUTC()}T00:00:00Z`;
      const { data: existing } = await supabase
        .from("events")
        .select("id")
        .eq("user_id", user.id)
        .eq("type", "app_opened")
        .gte("created_at", todayStart)
        .limit(1);
      if (!existing || existing.length === 0) {
        await supabase.from("events").insert({ user_id: user.id, type: "app_opened" });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.kind === "error") {
      const message =
        typeof body.message === "string" && body.message.trim()
          ? body.message.trim().slice(0, MAX_MESSAGE)
          : null;
      if (!message) return NextResponse.json({ ok: true });

      let userId: string | null = null;
      if (privyUserId) {
        const { data: user } = await supabase
          .from("users")
          .select("id")
          .eq("privy_user_id", privyUserId)
          .maybeSingle();
        userId = user?.id ?? null;
      }
      await supabase.from("client_errors").insert({
        user_id: userId,
        message,
        stack: typeof body.stack === "string" ? body.stack.slice(0, MAX_STACK) : null,
        url: typeof body.url === "string" ? body.url.slice(0, MAX_URL) : null,
        user_agent: (request.headers.get("user-agent") ?? "").slice(0, MAX_UA) || null,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/telemetry failed:", err);
    return NextResponse.json({ ok: true }); // never bubble telemetry failures
  }
}
