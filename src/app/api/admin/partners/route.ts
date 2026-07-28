import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { isCodeTaken, partnerStats } from "@/lib/partners";
import { normalizeReferralCode } from "@/lib/referral";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Admin CRUD for Accelerated Points partners, plus the per-partner roll-up.
 *
 *   GET    /api/admin/partners            list with consolidated stats
 *   GET    /api/admin/partners?id=…       the roster who joined via that code
 *   POST   /api/admin/partners            create
 *   PATCH  /api/admin/partners            update (rename, retune, deactivate)
 *
 * Admin-only. Codes are normalised with the same rule as user invite codes, so
 * `?ref=fittr` and `?ref=FITTR` are the same link.
 */

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");

  if (id) {
    // The roster for one partner: who joined, and how they are doing.
    const supabase = createSupabaseAdmin();
    const { data: users } = await supabase
      .from("users")
      .select("id, email, created_at, access_status, iki_score, boost_started_at, boost_floor_met")
      .eq("partner_id", id)
      .order("created_at", { ascending: false });

    const ids = (users ?? []).map((u) => u.id as string);
    const [{ data: balances }, { data: checkins }] =
      ids.length > 0
        ? await Promise.all([
            supabase.from("reward_points").select("user_id, points_balance").in("user_id", ids),
            supabase.from("daily_checkins").select("user_id, checkin_date").in("user_id", ids),
          ])
        : [{ data: [] }, { data: [] }];

    const balanceBy = new Map<string, number>();
    for (const b of balances ?? []) {
      balanceBy.set(b.user_id as string, (b.points_balance as number) ?? 0);
    }
    const countBy = new Map<string, number>();
    const lastBy = new Map<string, string>();
    for (const c of checkins ?? []) {
      const uid = c.user_id as string;
      const d = c.checkin_date as string;
      countBy.set(uid, (countBy.get(uid) ?? 0) + 1);
      if (!lastBy.has(uid) || d > lastBy.get(uid)!) lastBy.set(uid, d);
    }

    return NextResponse.json({
      members: (users ?? []).map((u) => ({
        id: u.id,
        email: u.email,
        joined: u.created_at,
        access_status: u.access_status,
        iki_score: Number(u.iki_score ?? 0),
        points: balanceBy.get(u.id as string) ?? 0,
        checkins: countBy.get(u.id as string) ?? 0,
        last_checkin: lastBy.get(u.id as string) ?? null,
        boost_started_at: u.boost_started_at,
        boost_floor_met: u.boost_floor_met,
      })),
    });
  }

  return NextResponse.json({ partners: await partnerStats() });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const code = normalizeReferralCode(b.code);
  if (!code) {
    return NextResponse.json(
      { error: "Codes are 3–16 letters/numbers." },
      { status: 400 },
    );
  }

  // A ?ref link carries ONE code, resolved against partners first — so a
  // partner code that collides with a user's invite code would silently
  // shadow it. No constraint can express that across two tables.
  const taken = await isCodeTaken(code);
  if (taken) {
    return NextResponse.json(
      {
        error:
          taken === "partner"
            ? `“${code}” is already a partner code.`
            : `“${code}” is already a user's invite code.`,
      },
      { status: 409 },
    );
  }

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("partners")
    .insert({
      name,
      code,
      ...(typeof b.multiplier === "number" ? { multiplier: b.multiplier } : {}),
      ...(typeof b.welcome_grant === "number" ? { welcome_grant: b.welcome_grant } : {}),
      ...(typeof b.notes === "string" ? { notes: b.notes } : {}),
    })
    .select("id, name, code")
    .single();

  if (error || !data) {
    console.error("partner create failed:", error);
    return NextResponse.json({ error: "Couldn't create partner" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, partner: data });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const id = typeof b.id === "string" ? b.id : null;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
  if (typeof b.active === "boolean") patch.active = b.active;
  if (typeof b.multiplier === "number") patch.multiplier = b.multiplier;
  if (typeof b.welcome_grant === "number") patch.welcome_grant = b.welcome_grant;
  if (typeof b.notes === "string") patch.notes = b.notes;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from("partners").update(patch).eq("id", id);
  if (error) {
    console.error("partner update failed:", error);
    return NextResponse.json({ error: "Couldn't update partner" }, { status: 500 });
  }

  // Deactivating only stops NEW signups getting the deal. Everyone already in
  // keeps their rate, because it lives on their own row — see migration 0013.
  return NextResponse.json({ ok: true });
}
