import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveReportUser } from "@/lib/biomarker-report-data";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * The redemption marketplace.
 *
 *   GET  /api/redemptions  -> { balance, items, history }
 *   POST /api/redemptions  -> redeem a voucher item -> { code, redeem_instructions, balance }
 *
 * Vouchers cost iki points and issue a code from a pre-loaded pool (atomic, via
 * the redeem_voucher() DB function). Affiliate items are free click-outs handled
 * client-side. Service-role DB access, Privy-authed.
 */

/** Map a redeem_voucher() coded exception to a friendly message + HTTP status. */
const REDEEM_ERRORS: Record<string, { message: string; status: number }> = {
  insufficient_points: {
    message: "You don't have enough iki points for this yet.",
    status: 400,
  },
  no_balance: { message: "You don't have any iki points yet.", status: 400 },
  out_of_stock: { message: "This voucher just sold out — try another.", status: 409 },
  not_available: { message: "This item isn't available right now.", status: 409 },
  not_a_voucher: { message: "This item can't be redeemed for points.", status: 400 },
  item_not_found: { message: "That item no longer exists.", status: 404 },
};

export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const resolved = await resolveReportUser(privyUserId);
    if (!resolved) {
      return NextResponse.json({ balance: 0, items: [], history: [] });
    }
    const supabase = createSupabaseAdmin();

    const [{ data: balanceRow }, { data: items }, { data: codes }, { data: history }] =
      await Promise.all([
        supabase
          .from("reward_points")
          .select("points_balance")
          .eq("profile_id", resolved.profileId)
          .maybeSingle(),
        supabase
          .from("redemption_items")
          .select(
            "id, name, partner, description, category, points_cost, discount_value, inventory_status, kind, affiliate_url, image_url, redeem_instructions, terms",
          )
          .neq("inventory_status", "out_of_stock")
          .order("kind")
          .order("points_cost"),
        supabase.from("voucher_codes").select("item_id").eq("status", "available"),
        supabase
          .from("redemption_transactions")
          .select(
            "id, points_spent, status, discount_code, redeemed_at, created_at, item:redemption_items(name, partner, redeem_instructions)",
          )
          .eq("profile_id", resolved.profileId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

    // Available-code count per voucher item, so the UI can show "sold out".
    const stock = new Map<string, number>();
    for (const c of codes ?? []) {
      const id = (c as { item_id: string }).item_id;
      stock.set(id, (stock.get(id) ?? 0) + 1);
    }
    const catalog = (items ?? []).map((it) => ({
      ...it,
      available_codes: it.kind === "voucher" ? (stock.get(it.id) ?? 0) : null,
    }));

    return NextResponse.json({
      balance: balanceRow?.points_balance ?? 0,
      items: catalog,
      history: history ?? [],
    });
  } catch (err) {
    console.error("GET /api/redemptions failed:", err);
    return NextResponse.json({ error: "Failed to load rewards" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const itemId = (body as Record<string, unknown>).item_id;
  if (typeof itemId !== "string") {
    return NextResponse.json({ error: "Missing item_id" }, { status: 400 });
  }

  try {
    const resolved = await resolveReportUser(privyUserId);
    if (!resolved) {
      return NextResponse.json({ error: "User not found" }, { status: 409 });
    }
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("redeem_voucher", {
        p_user_id: resolved.userId,
        p_profile_id: resolved.profileId,
        p_item_id: itemId,
      })
      .single();

    if (error) {
      // Match the coded exception the function raised.
      const key = Object.keys(REDEEM_ERRORS).find((k) => error.message.includes(k));
      if (key) {
        const m = REDEEM_ERRORS[key];
        return NextResponse.json({ error: m.message }, { status: m.status });
      }
      throw new Error(`redeem_voucher failed: ${error.message}`);
    }

    const result = data as {
      code: string;
      redeem_instructions: string | null;
      new_balance: number;
    };
    return NextResponse.json({
      code: result.code,
      redeem_instructions: result.redeem_instructions,
      balance: result.new_balance,
    });
  } catch (err) {
    console.error("POST /api/redemptions failed:", err);
    return NextResponse.json({ error: "Couldn't redeem right now. Please try again." }, {
      status: 500,
    });
  }
}
