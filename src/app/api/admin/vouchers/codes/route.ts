import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * POST /api/admin/vouchers/codes — bulk-load voucher codes into an item's pool.
 * Body: { item_id, codes: string[] }. Duplicate codes (per item) are silently
 * skipped by the (item_id, code) unique index, so re-uploads are safe.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const itemId = typeof b.item_id === "string" ? b.item_id : null;
  const rawCodes = Array.isArray(b.codes) ? b.codes : [];
  if (!itemId) return NextResponse.json({ error: "Missing item_id" }, { status: 400 });

  // Normalize: trim, drop blanks, de-dupe within the upload.
  const codes = Array.from(
    new Set(
      rawCodes
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  );
  if (codes.length === 0) {
    return NextResponse.json({ error: "No codes to add" }, { status: 400 });
  }

  const supabase = createSupabaseAdmin();
  // Confirm the item exists and is a voucher.
  const { data: item } = await supabase
    .from("redemption_items")
    .select("id, kind")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (item.kind !== "voucher") {
    return NextResponse.json({ error: "Only voucher items take codes" }, { status: 400 });
  }

  // Insert, ignoring duplicates against the (item_id, code) unique index.
  const { data, error } = await supabase
    .from("voucher_codes")
    .upsert(
      codes.map((code) => ({ item_id: itemId, code })),
      { onConflict: "item_id,code", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    console.error("admin bulk codes failed:", error);
    return NextResponse.json({ error: "Couldn't add codes" }, { status: 500 });
  }
  return NextResponse.json({ added: data?.length ?? 0, submitted: codes.length });
}
