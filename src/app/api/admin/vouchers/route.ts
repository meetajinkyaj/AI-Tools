import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Admin catalog management.
 *   GET    /api/admin/vouchers          -> items + code counts
 *   POST   /api/admin/vouchers          -> create a voucher/affiliate item
 *   PATCH  /api/admin/vouchers          -> update an item's inventory_status
 *   DELETE /api/admin/vouchers?id=...    -> delete an item (blocked if redeemed)
 */

const INVENTORY = new Set(["in_stock", "out_of_stock", "coming_soon"]);
const KINDS = new Set(["voucher", "affiliate"]);

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const supabase = createSupabaseAdmin();
  const [{ data: items }, { data: codes }] = await Promise.all([
    supabase.from("redemption_items").select("*").order("created_at", { ascending: false }),
    supabase.from("voucher_codes").select("item_id, status"),
  ]);

  const total = new Map<string, number>();
  const available = new Map<string, number>();
  for (const c of codes ?? []) {
    const id = (c as { item_id: string; status: string }).item_id;
    total.set(id, (total.get(id) ?? 0) + 1);
    if ((c as { status: string }).status === "available") {
      available.set(id, (available.get(id) ?? 0) + 1);
    }
  }
  const withCounts = (items ?? []).map((it) => ({
    ...it,
    codes_total: total.get(it.id) ?? 0,
    codes_available: available.get(it.id) ?? 0,
  }));
  return NextResponse.json({ items: withCounts });
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

  const kind = typeof b.kind === "string" && KINDS.has(b.kind) ? b.kind : "voucher";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const points_cost =
    kind === "affiliate" ? 0 : Math.max(0, Math.round(Number(b.points_cost) || 0));
  if (kind === "affiliate" && typeof b.affiliate_url !== "string") {
    return NextResponse.json({ error: "Affiliate URL is required" }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const inventory = typeof b.inventory_status === "string" && INVENTORY.has(b.inventory_status)
    ? b.inventory_status
    : "in_stock";

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("redemption_items")
    .insert({
      kind,
      name,
      partner: str(b.partner),
      description: str(b.description),
      category: str(b.category),
      points_cost,
      discount_value: str(b.discount_value),
      inventory_status: inventory,
      affiliate_url: str(b.affiliate_url),
      image_url: str(b.image_url),
      redeem_instructions: str(b.redeem_instructions),
      terms: str(b.terms),
    })
    .select("*")
    .single();
  if (error) {
    console.error("admin create item failed:", error);
    return NextResponse.json({ error: "Couldn't create item" }, { status: 500 });
  }
  return NextResponse.json({ item: data });
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
  const inventory_status =
    typeof b.inventory_status === "string" && INVENTORY.has(b.inventory_status)
      ? b.inventory_status
      : null;
  if (!id || !inventory_status) {
    return NextResponse.json({ error: "id and inventory_status required" }, { status: 400 });
  }
  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from("redemption_items")
    .update({ inventory_status })
    .eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't update item" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = createSupabaseAdmin();
  // Hard delete. Users' redemption history survives — each transaction keeps a
  // snapshot of the item's name (migration 0011) and its issued code; unredeemed
  // codes cascade away with the item.
  const { error } = await supabase.from("redemption_items").delete().eq("id", id);
  if (error) {
    console.error("admin item delete failed:", error);
    return NextResponse.json({ error: "Couldn't delete item" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
