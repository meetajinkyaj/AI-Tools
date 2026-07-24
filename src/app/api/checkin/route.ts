import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import {
  computeAwards,
  computeStreak,
  displayStreak,
  todayUTC,
  totalAwarded,
  validateCheckinInput,
} from "@/lib/checkin";
import { getOrCreateSelfProfileId } from "@/lib/profiles";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Daily check-in for the authenticated user.
 *
 *   GET  /api/checkin  -> { checkin, checkedInToday, streak, pointsBalance }
 *   POST /api/checkin  -> { checkin, checkedInToday, streak, pointsAwarded, pointsBalance }
 *
 * The day's FIRST check-in earns iki points (base + streak bonuses) and is
 * written to the append-only points ledger; later edits to the same day update
 * the row without re-awarding. All DB access uses the service-role key.
 */

async function resolveUserId(privyUserId: string): Promise<string | null> {
  // Beta gate: unapproved users resolve to null (see app-user.ts).
  return resolveApprovedUserId(privyUserId);
}

async function getPointsBalance(profileId: string): Promise<number> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("reward_points")
    .select("points_balance")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`reward_points lookup failed: ${error.message}`);
  return data?.points_balance ?? 0;
}

export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const userId = await resolveUserId(privyUserId);
    if (!userId) {
      return NextResponse.json({
        checkin: null,
        checkedInToday: false,
        streak: 0,
        pointsBalance: 0,
      });
    }
    const profileId = await getOrCreateSelfProfileId(userId);

    const supabase = createSupabaseAdmin();
    const today = todayUTC();

    const { data: recent, error: recentError } = await supabase
      .from("daily_checkins")
      .select("*")
      .eq("profile_id", profileId)
      .order("checkin_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentError) throw new Error(`daily_checkins select failed: ${recentError.message}`);

    const checkedInToday = recent?.checkin_date === today;
    const streak = displayStreak(
      recent?.checkin_date ?? null,
      recent?.streak_count ?? 0,
      today,
    );
    const pointsBalance = await getPointsBalance(profileId);

    return NextResponse.json({
      checkin: checkedInToday ? recent : null,
      checkedInToday,
      streak,
      pointsBalance,
    });
  } catch (err) {
    console.error("GET /api/checkin failed:", err);
    return NextResponse.json({ error: "Failed to load check-in" }, { status: 500 });
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

  const validation = validateCheckinInput(rawBody);
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
    const today = todayUTC();

    // Has the user already checked in today? (edit vs. first check-in)
    const { data: existingToday, error: existingError } = await supabase
      .from("daily_checkins")
      .select("*")
      .eq("profile_id", profileId)
      .eq("checkin_date", today)
      .maybeSingle();
    if (existingError) throw new Error(`daily_checkins lookup failed: ${existingError.message}`);

    // --- Edit an existing check-in: update fields, no points, keep streak. ---
    if (existingToday) {
      const { data: updated, error: updateError } = await supabase
        .from("daily_checkins")
        .update({ ...validation.value })
        .eq("id", existingToday.id)
        .select("*")
        .single();
      if (updateError || !updated) {
        throw new Error(`daily_checkins update failed: ${updateError?.message ?? "no row"}`);
      }
      const pointsBalance = await getPointsBalance(profileId);
      return NextResponse.json({
        checkin: updated,
        checkedInToday: true,
        streak: updated.streak_count,
        pointsAwarded: 0,
        pointsBalance,
      });
    }

    // --- First check-in today: compute the streak from the last one. ---
    const { data: prior, error: priorError } = await supabase
      .from("daily_checkins")
      .select("checkin_date, streak_count")
      .eq("profile_id", profileId)
      .order("checkin_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorError) throw new Error(`daily_checkins prior lookup failed: ${priorError.message}`);

    const streak = computeStreak(
      prior?.checkin_date ?? null,
      prior?.streak_count ?? 0,
      today,
    );

    const { data: created, error: insertError } = await supabase
      .from("daily_checkins")
      .insert({
        user_id: userId,
        profile_id: profileId,
        checkin_date: today,
        streak_count: streak,
        ...validation.value,
      })
      .select("*")
      .single();
    if (insertError || !created) {
      throw new Error(`daily_checkins insert failed: ${insertError?.message ?? "no row"}`);
    }

    // Award points: base + any streak bonus, to the ledger and the balance.
    const awards = computeAwards(streak);
    const earned = totalAwarded(awards);

    const priorBalance = await getPointsBalance(profileId);
    const { data: balanceRow, error: balanceError } = await supabase
      .from("reward_points")
      .upsert(
        { user_id: userId, profile_id: profileId, points_balance: priorBalance + earned },
        { onConflict: "profile_id" },
      )
      .select("points_balance")
      .single();
    if (balanceError || !balanceRow) {
      throw new Error(`reward_points upsert failed: ${balanceError?.message ?? "no row"}`);
    }

    // Best-effort ledger writes; don't fail the check-in if they don't land.
    await supabase.from("points_transactions").insert(
      awards.map((a) => ({
        user_id: userId,
        profile_id: profileId,
        type: "earn",
        amount: a.amount,
        reason: a.reason,
        reference_id: created.id,
      })),
    );

    return NextResponse.json({
      checkin: created,
      checkedInToday: true,
      streak,
      pointsAwarded: earned,
      pointsBalance: balanceRow.points_balance,
    });
  } catch (err) {
    console.error("POST /api/checkin failed:", err);
    return NextResponse.json({ error: "Failed to save check-in" }, { status: 500 });
  }
}
