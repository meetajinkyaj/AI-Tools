import "server-only";

import {
  accelerateAwards,
  countsTowardRank,
  effectiveMultiplier,
  meetsActivityFloor,
  needsFloorEvaluation,
  totalSpendable,
  totalTowardRank,
  WELCOME_GRANT_REASON,
  type AcceleratedAward,
  type Award,
} from "./accelerated-points";
import { rankUpCrossed, type Rank } from "./iki-rank";
import { getOrCreateSelfProfileId } from "./profiles";
import { createSupabaseAdmin } from "./supabase-admin";

/**
 * The one place points are credited.
 *
 * Every earn now writes to TWO ledgers, and getting that split wrong in one
 * route and right in another is exactly the kind of drift that produces
 * balances nobody can explain a year later. So all of it lives here:
 *
 *   reward_points.points_balance  spendable, boosted, falls on redemption
 *   users.iki_score               lifetime, base only, never falls
 *
 * and every ledger row carries the base amount and the multiplier that
 * produced it, so a balance is always reconstructible from first principles.
 */

export interface CreditResult {
  /** Boosted points added to the spendable balance. */
  awarded: number;
  /** Base points added to lifetime score. */
  scoreAdded: number;
  balance: number;
  ikiScore: number;
  multiplier: number;
  /** Set when this earn crossed a rank boundary, drives the celebration. */
  rankUp: Rank | null;
}

interface EarnerRow {
  boost_started_at: string | null;
  boost_floor_met: boolean | null;
  iki_score: number | null;
}

/**
 * Evaluate the day-90 activity floor if it is due, and freeze the answer.
 *
 * Done lazily on the next earn rather than by a scheduled job: there is no cron
 * to own, monitor, or discover has been quietly failing for a month, and the
 * answer is only ever needed at the moment someone earns.
 */
async function resolveFloorIfDue(
  userId: string,
  earner: EarnerRow,
  now: Date,
): Promise<EarnerRow> {
  if (!needsFloorEvaluation(earner, now)) return earner;

  const supabase = createSupabaseAdmin();
  const started = earner.boost_started_at;
  if (!started) return earner;

  // Count check-ins inside the boost window only.
  const windowEnd = new Date(Date.parse(started) + 90 * 86_400_000).toISOString();
  const { count } = await supabase
    .from("daily_checkins")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", started)
    .lt("created_at", windowEnd);

  const met = meetsActivityFloor(count ?? 0);
  await supabase.from("users").update({ boost_floor_met: met }).eq("id", userId);
  return { ...earner, boost_floor_met: met };
}

/**
 * Credit a batch of awards to both ledgers.
 *
 * Best-effort on the ledger write, like the code it replaces: a points hiccup
 * must never fail the check-in or panel save that earned them.
 */
export async function creditPoints(
  userId: string,
  awards: readonly Award[],
  opts: { referenceId?: string; extraTxnFields?: Record<string, unknown>[] } = {},
  now: Date = new Date(),
): Promise<CreditResult> {
  const supabase = createSupabaseAdmin();
  const profileId = await getOrCreateSelfProfileId(userId);

  const { data: raw } = await supabase
    .from("users")
    .select("boost_started_at, boost_floor_met, iki_score")
    .eq("id", userId)
    .maybeSingle();

  let earner: EarnerRow = {
    boost_started_at: (raw?.boost_started_at as string | null) ?? null,
    boost_floor_met: (raw?.boost_floor_met as boolean | null) ?? null,
    iki_score: Number(raw?.iki_score ?? 0),
  };
  earner = await resolveFloorIfDue(userId, earner, now);

  const multiplier = effectiveMultiplier(earner, now);
  const accelerated = accelerateAwards(awards, multiplier);
  const awarded = totalSpendable(accelerated);
  const scoreAdded = totalTowardRank(accelerated);

  const priorScore = earner.iki_score ?? 0;

  const { data: balanceRow } = await supabase
    .from("reward_points")
    .select("points_balance")
    .eq("profile_id", profileId)
    .maybeSingle();
  const priorBalance = balanceRow?.points_balance ?? 0;

  const { data: updatedBalance } = await supabase
    .from("reward_points")
    .upsert(
      { user_id: userId, profile_id: profileId, points_balance: priorBalance + awarded },
      { onConflict: "profile_id" },
    )
    .select("points_balance")
    .single();

  const nextScore = priorScore + scoreAdded;
  if (scoreAdded > 0) {
    await supabase.from("users").update({ iki_score: nextScore }).eq("id", userId);
  }

  await writeLedger(userId, profileId, accelerated, opts);

  return {
    awarded,
    scoreAdded,
    balance: updatedBalance?.points_balance ?? priorBalance + awarded,
    ikiScore: nextScore,
    multiplier,
    rankUp: rankUpCrossed(priorScore, nextScore),
  };
}

async function writeLedger(
  userId: string,
  profileId: string,
  awards: AcceleratedAward[],
  opts: { referenceId?: string; extraTxnFields?: Record<string, unknown>[] },
): Promise<void> {
  const supabase = createSupabaseAdmin();
  await supabase.from("points_transactions").insert(
    awards.map((a, i) => ({
      user_id: userId,
      profile_id: profileId,
      type: "earn",
      amount: a.amount,
      base_amount: a.baseAmount,
      multiplier: a.multiplier,
      reason: a.reason,
      ...(opts.referenceId ? { reference_id: opts.referenceId } : {}),
      ...(opts.extraTxnFields?.[i] ?? {}),
    })),
  );
}

/**
 * The partner welcome grant. Spendable, and deliberately NOT counted toward
 * rank, see `countsTowardRank`. Kept here so the exclusion is enforced by the
 * same code path that enforces it for everything else.
 */
export async function grantWelcomePoints(
  userId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  // Sanity: the reason must be one the rank rule excludes, or a grant would
  // quietly raise someone's rank.
  if (countsTowardRank(WELCOME_GRANT_REASON)) {
    console.error("welcome grant reason is not rank-excluded, refusing to grant");
    return;
  }
  try {
    await creditPoints(userId, [
      { amount, reason: WELCOME_GRANT_REASON },
    ]);
  } catch (err) {
    // A failed grant must never block a signup.
    console.error("welcome grant failed (non-fatal):", err);
  }
}
