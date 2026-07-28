import "server-only";

import { creditPoints } from "./credit-points";
import { POINTS, POINTS_REASON, REFERRAL_PANEL_WINDOW_DAYS } from "./points";
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

    // Credited through the shared path so this raises iki_score like every
    // other earn. It is never multiplied — accelerate-points excludes referral
    // reasons, since these pay for someone ELSE's behaviour.
    await creditPoints(referrerId, [{ amount, reason }], {
      referenceId: referredUserId,
    });

    // The referrer's own milestones: 7 and 30 friends ONBOARDED, mirroring the
    // check-in streak ladder. Checked after each per-friend award, so the
    // milestone lands the moment the qualifying friend completes onboarding.
    if (reason === POINTS_REASON.referralOnboard) {
      await awardReferrerVolumeMilestones(referrerId);
    }
  } catch (err) {
    console.error("Referral milestone award failed (non-fatal):", err);
  }
}

/**
 * Pay the referrer for reaching 7 and 30 onboarded friends.
 *
 * Counted from the ledger — one `referral` txn exists per friend who completed
 * onboarding — rather than from raw signups. A signup that never onboards costs
 * nothing to create, so counting those would make the milestone farmable with
 * throwaway addresses.
 */
export async function awardReferrerVolumeMilestones(
  referrerId: string,
): Promise<void> {
  const supabase = createSupabaseAdmin();
  const { count } = await supabase
    .from("points_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", referrerId)
    .eq("reason", POINTS_REASON.referralOnboard);

  const friends = count ?? 0;
  const tiers: { at: number; reason: string; amount: number }[] = [
    { at: 7, reason: POINTS_REASON.referrer7, amount: POINTS.referrer7Friends },
    { at: 30, reason: POINTS_REASON.referrer30, amount: POINTS.referrer30Friends },
  ];

  for (const tier of tiers) {
    if (friends < tier.at) continue;
    // Once ever, ledger-checked — the same at-most-once rule the per-friend
    // milestones use.
    const { data: paid } = await supabase
      .from("points_transactions")
      .select("id")
      .eq("user_id", referrerId)
      .eq("reason", tier.reason)
      .limit(1);
    if (paid && paid.length > 0) continue;
    await creditPoints(referrerId, [{ amount: tier.amount, reason: tier.reason }]);
  }
}

export { REFERRAL_PANEL_WINDOW_DAYS };
