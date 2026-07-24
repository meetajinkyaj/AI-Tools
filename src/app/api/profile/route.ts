import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import { POINTS, POINTS_REASON } from "@/lib/points";
import { awardReferralMilestone } from "@/lib/referral-award";
import { validateProfileInput } from "@/lib/profile";
import { getOrCreateSelfProfileId } from "@/lib/profiles";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Profile read/write for the authenticated user.
 *
 *   GET  /api/profile  -> { profile: <row> | null }
 *   POST /api/profile  -> { profile: <row> }   (create or update, validated)
 *
 * Both verify the Privy access token, resolve the caller's `users` row, and
 * operate only on that user's profile. DB access uses the service-role key.
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
    if (!userId) {
      // User row not created yet (sync hasn't run) — treat as no profile.
      return NextResponse.json({ profile: null });
    }

    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .eq("relationship", "self")
      .maybeSingle();
    if (error) {
      throw new Error(`profiles select failed: ${error.message}`);
    }
    return NextResponse.json({ profile: data ?? null });
  } catch (err) {
    console.error("GET /api/profile failed:", err);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
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

  const validation = validateProfileInput(rawBody);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const userId = await resolveUserId(privyUserId);
    if (!userId) {
      // The user must be synced (users row created) before creating a profile.
      return NextResponse.json({ error: "User not found" }, { status: 409 });
    }

    const supabase = createSupabaseAdmin();

    // Was the self profile already filled in (vs. auto-created empty)? Drives the
    // created/updated audit event.
    const { data: existing, error: existingError } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", userId)
      .eq("relationship", "self")
      .maybeSingle();
    if (existingError) {
      throw new Error(`profiles lookup failed: ${existingError.message}`);
    }
    const wasSetUp = Boolean(existing?.full_name);

    const profileId = await getOrCreateSelfProfileId(userId);
    const { data: profile, error: updateError } = await supabase
      .from("profiles")
      .update({ ...validation.value })
      .eq("id", profileId)
      .select("*")
      .single();
    if (updateError || !profile) {
      throw new Error(`profiles update failed: ${updateError?.message ?? "no row"}`);
    }

    // Best-effort event; don't fail the request if it doesn't land.
    await supabase.from("events").insert({
      user_id: userId,
      type: wasSetUp ? "profile_updated" : "profile_created",
    });

    // Referral tier 1: the FIRST onboarding completion pays the referrer
    // (signup alone earns nothing). Idempotent + best-effort (see referral-award).
    if (!wasSetUp) {
      await awardReferralMilestone(userId, POINTS_REASON.referralOnboard, POINTS.referralOnboard);
    }

    return NextResponse.json({ profile });
  } catch (err) {
    console.error("POST /api/profile failed:", err);
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
  }
}
