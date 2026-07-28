import "server-only";

import { effectiveMultiplier } from "./accelerated-points";
import { createSupabaseAdmin } from "./supabase-admin";

/**
 * Partners — the entity behind an Accelerated Points code.
 *
 * A partner is a gym, a community or a brand, not a user. See migration 0013
 * for why that distinction forced its own table.
 */

export interface Partner {
  id: string;
  name: string;
  code: string;
  multiplier: number;
  welcome_grant: number;
  active: boolean;
}

/**
 * Resolve a `?ref` code to an ACTIVE partner.
 *
 * Inactive partners resolve to null, so ending a partnership stops new signups
 * getting the deal — while everyone already in keeps theirs, because their rate
 * lives on their own row.
 */
export async function findActivePartnerByCode(
  code: string,
): Promise<Partner | null> {
  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("partners")
    .select("id, name, code, multiplier, welcome_grant, active")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;
  return { ...data, multiplier: Number(data.multiplier) } as Partner;
}

/**
 * Is this code already taken, by either a partner or a user?
 *
 * This is for the ERROR MESSAGE, not for correctness. The guarantee lives in
 * the database: both tables sync into `invite_codes`, whose primary key makes a
 * collision impossible from either direction (migration 0013). Checking here
 * first just turns a constraint violation into "FITTR is already a user's
 * invite code" instead of an opaque 500.
 */
export async function isCodeTaken(
  code: string,
  exceptPartnerId?: string,
): Promise<"partner" | "user" | null> {
  const supabase = createSupabaseAdmin();

  const { data: partner } = await supabase
    .from("partners")
    .select("id")
    .ilike("code", code)
    .maybeSingle();
  if (partner && partner.id !== exceptPartnerId) return "partner";

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("referral_code", code)
    .maybeSingle();
  if (user) return "user";

  return null;
}

/* ----------------------------- the roll-up ------------------------------- */

export interface PartnerStats extends Partner {
  signups: number;
  onboarded: number;
  activated: number;
  /** Spendable points issued to this partner's cohort, boost included. */
  pointsIssued: number;
  /** Of that, how much came from the multiplier and the welcome grants. */
  boostCost: number;
  redemptions: number;
  /** How many are still inside the 2x window. */
  inBoostWindow: number;
}

/**
 * Per-partner numbers for the admin console.
 *
 * Aggregated in memory, which is right at beta scale and would need moving into
 * SQL somewhere north of a few thousand users per partner.
 */
export async function partnerStats(): Promise<PartnerStats[]> {
  const supabase = createSupabaseAdmin();
  const now = new Date();

  const [{ data: partners }, { data: users }, { data: profiles }, { data: panels }] =
    await Promise.all([
      supabase
        .from("partners")
        .select("id, name, code, multiplier, welcome_grant, active")
        .order("created_at", { ascending: false }),
      supabase
        .from("users")
        .select("id, partner_id, boost_started_at, boost_floor_met")
        .not("partner_id", "is", null),
      supabase
        .from("profiles")
        .select("user_id")
        .eq("relationship", "self")
        .not("full_name", "is", null),
      supabase.from("biomarker_panels").select("user_id"),
    ]);

  if (!partners || partners.length === 0) return [];

  const cohort = new Map<string, string[]>();
  const boostOpen = new Map<string, number>();
  for (const u of users ?? []) {
    const pid = u.partner_id as string;
    cohort.set(pid, [...(cohort.get(pid) ?? []), u.id as string]);
    if (effectiveMultiplier(u, now) > 1) {
      boostOpen.set(pid, (boostOpen.get(pid) ?? 0) + 1);
    }
  }

  const allIds = [...cohort.values()].flat();
  // Ledger and redemption rows only for the partner cohort — at beta scale
  // this is a handful of users, and asking for everyone would not scale.
  const [{ data: txns }, { data: redemptions }] =
    allIds.length > 0
      ? await Promise.all([
          supabase
            .from("points_transactions")
            .select("user_id, amount, base_amount, reason, type")
            .in("user_id", allIds)
            .eq("type", "earn"),
          supabase
            .from("redemption_transactions")
            .select("user_id")
            .in("user_id", allIds),
        ])
      : [{ data: [] }, { data: [] }];

  const onboardedIds = new Set((profiles ?? []).map((p) => p.user_id as string));
  const panelIds = new Set((panels ?? []).map((p) => p.user_id as string));

  const issued = new Map<string, number>();
  const boosted = new Map<string, number>();
  for (const t of txns ?? []) {
    const uid = t.user_id as string;
    const amount = (t.amount as number) ?? 0;
    const base = (t.base_amount as number) ?? amount;
    issued.set(uid, (issued.get(uid) ?? 0) + amount);
    boosted.set(uid, (boosted.get(uid) ?? 0) + (amount - base));
  }
  const redeemed = new Map<string, number>();
  for (const r of redemptions ?? []) {
    const uid = r.user_id as string;
    redeemed.set(uid, (redeemed.get(uid) ?? 0) + 1);
  }

  return (partners ?? []).map((p) => {
    const ids = cohort.get(p.id as string) ?? [];
    const sum = (m: Map<string, number>) =>
      ids.reduce((acc, id) => acc + (m.get(id) ?? 0), 0);
    return {
      id: p.id as string,
      name: p.name as string,
      code: p.code as string,
      multiplier: Number(p.multiplier),
      welcome_grant: p.welcome_grant as number,
      active: p.active as boolean,
      signups: ids.length,
      onboarded: ids.filter((id) => onboardedIds.has(id)).length,
      activated: ids.filter((id) => panelIds.has(id)).length,
      pointsIssued: sum(issued),
      boostCost: sum(boosted),
      redemptions: sum(redeemed),
      inBoostWindow: boostOpen.get(p.id as string) ?? 0,
    };
  });
}
