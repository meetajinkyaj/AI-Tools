import "server-only";

import { REFERRAL_PANEL_WINDOW_DAYS } from "./points";
import { getOrCreateSelfProfileId } from "./profiles";
import { createSupabaseAdmin } from "./supabase-admin";

/**
 * Referral milestone awards — pay the REFERRER when their referred friend hits
 * a milestone (onboarding completed / first 7-day streak / first panel within
 * the signup window). One shared implementation so all three hooks behave
 * identically:
 *   - at-most-once per (milestone, referred friend): the ledger is checked for
 *     an existing txn with this reason + reference_id (= referred user's id);
 *   - best-effort: never throws — a referral hiccup must never fail the
 *     friend's check-in, onboarding, or panel save.
 */
export async function awardReferralMilestone(
  referredUserId: string,
  reason: string,
  amount: number,
  opts: { withinDaysOfSignup?: number } = {},
): Promise<void> {
  try {
    const supabase = createSupabaseAdmin();
    const { data: referred } = await supabase
      .from("users")
      .select("referred_by, created_at")
      .eq("id", referredUserId)
      .maybeSingle();
    const referrerId = referred?.referred_by as string | null;
    if (!referrerId) return;

    // Optional freshness window (e.g. first panel within 30 days of joining).
    if (opts.withinDaysOfSignup != null && referred?.created_at) {
      const ageMs = Date.now() - Date.parse(referred.created_at as string);
      if (ageMs > opts.withinDaysOfSignup * 86_400_000) return;
    }

    // Already paid for this milestone + friend?
    const { data: existing } = await supabase
      .from("points_transactions")
      .select("id")
      .eq("reason", reason)
      .eq("reference_id", referredUserId)
      .limit(1);
    if (existing && existing.length > 0) return;

    const referrerProfileId = await getOrCreateSelfProfileId(referrerId);
    const { data: balanceRow } = await supabase
      .from("reward_points")
      .select("points_balance")
      .eq("profile_id", referrerProfileId)
      .maybeSingle();
    await supabase.from("reward_points").upsert(
      {
        user_id: referrerId,
        profile_id: referrerProfileId,
        points_balance: (balanceRow?.points_balance ?? 0) + amount,
      },
      { onConflict: "profile_id" },
    );
    await supabase.from("points_transactions").insert({
      user_id: referrerId,
      profile_id: referrerProfileId,
      type: "earn",
      amount,
      reason,
      reference_id: referredUserId,
    });
  } catch (err) {
    console.error("Referral milestone award failed (non-fatal):", err);
  }
}

export { REFERRAL_PANEL_WINDOW_DAYS };
