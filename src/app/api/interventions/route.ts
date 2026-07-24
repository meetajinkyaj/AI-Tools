import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import { validateInterventionInput } from "@/lib/interventions";
import { getOrCreateSelfProfileId } from "@/lib/profiles";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Intervention log for the authenticated user's self profile.
 *
 *   GET  /api/interventions  -> { interventions: [...] }   (most recent first)
 *   POST /api/interventions  -> { intervention: <row> }    (create)
 *
 * Rows hang off profile_id (the family-vault ownership axis). DB access uses the
 * service-role key.
 */

async function resolveUserId(privyUserId: string): Promise<string | null> {
  // Beta gate: unapproved users resolve to null (see app-user.ts).
  return resolveApprovedUserId(privyUserId);
}

export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const userId = await resolveUserId(privyUserId);
    if (!userId) return NextResponse.json({ interventions: [] });
    const profileId = await getOrCreateSelfProfileId(userId);

    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("intervention_log")
      .select("*")
      .eq("profile_id", profileId)
      .order("started_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`intervention_log select failed: ${error.message}`);

    return NextResponse.json({ interventions: data ?? [] });
  } catch (err) {
    console.error("GET /api/interventions failed:", err);
    return NextResponse.json({ error: "Failed to load your log" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const validation = validateInterventionInput(rawBody);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const userId = await resolveUserId(privyUserId);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 409 });
    }
    const profileId = await getOrCreateSelfProfileId(userId);

    const supabase = createSupabaseAdmin();
    const { data: intervention, error } = await supabase
      .from("intervention_log")
      .insert({
        user_id: userId,
        profile_id: profileId,
        type: validation.value.type,
        label: validation.value.label,
        dose_note: validation.value.dose_note,
        started_at: validation.value.started_at ?? undefined,
        ended_at: validation.value.ended_at,
      })
      .select("*")
      .single();
    if (error || !intervention) {
      throw new Error(`intervention_log insert failed: ${error?.message ?? "no row"}`);
    }

    await supabase.from("events").insert({
      user_id: userId,
      type: "intervention_logged",
      metadata: { intervention_id: intervention.id, kind: validation.value.type },
    });

    return NextResponse.json({ intervention });
  } catch (err) {
    console.error("POST /api/interventions failed:", err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
