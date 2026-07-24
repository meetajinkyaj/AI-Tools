import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import { POINTS, POINTS_REASON, REFERRAL_MAX_TOTAL, REFERRAL_PANEL_WINDOW_DAYS } from "@/lib/points";
import { generateReferralCode, nameBasedCode, referralLink } from "@/lib/referral";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/referral — the user's invite kit:
 * their code (generated lazily on first request), the share link, how many
 * friends joined via it, and how many completed onboarding (= earned them the
 * referral bonus). Approved users only.
 */
export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const userId = await resolveApprovedUserId(privyUserId);
    if (!userId) {
      return NextResponse.json({ error: "Not available" }, { status: 403 });
    }
    const supabase = createSupabaseAdmin();

    const { data: me, error: meError } = await supabase
      .from("users")
      .select("referral_code")
      .eq("id", userId)
      .single();
    if (meError) throw new Error(`users select failed: ${meError.message}`);

    let code = me.referral_code as string | null;
    if (!code) {
      // Lazy generation, name-first: "AJINKYA", then "AJINKYA2"… on collision
      // (the unique index arbitrates), with a random code as the final
      // fallback. The sender shares the link knowingly, so a readable,
      // name-based code is friendlier and less scammy-looking than random.
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", userId)
        .eq("relationship", "self")
        .maybeSingle();
      const fullName = (profile?.full_name as string | null) ?? null;

      for (let attempt = 0; attempt < 6 && !code; attempt++) {
        const candidate =
          nameBasedCode(fullName, attempt) ?? generateReferralCode();
        const { error } = await supabase
          .from("users")
          .update({ referral_code: candidate })
          .eq("id", userId)
          .is("referral_code", null);
        if (!error) {
          const { data: after } = await supabase
            .from("users")
            .select("referral_code")
            .eq("id", userId)
            .single();
          code = (after?.referral_code as string | null) ?? null;
        }
        // On a unique-violation error, loop: the next attempt tries "NAME2" etc.
      }
      if (!code) throw new Error("could not assign a referral code");
    }

    const [{ count: joined }, { count: completed }] = await Promise.all([
      supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("referred_by", userId),
      supabase
        .from("points_transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("reason", POINTS_REASON.referralOnboard),
    ]);

    return NextResponse.json({
      code,
      link: referralLink(code),
      joined: joined ?? 0,
      completed: completed ?? 0,
      tiers: {
        onboard: POINTS.referralOnboard,
        streak: POINTS.referralStreak,
        panel: POINTS.referralPanel,
        panelWindowDays: REFERRAL_PANEL_WINDOW_DAYS,
      },
      maxTotal: REFERRAL_MAX_TOTAL,
    });
  } catch (err) {
    console.error("GET /api/referral failed:", err);
    return NextResponse.json({ error: "Failed to load referral info" }, { status: 500 });
  }
}
