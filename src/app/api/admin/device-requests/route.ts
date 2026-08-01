import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { tallyRequests, type RequestRow } from "@/lib/device-requests";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/admin/device-requests, the ranked tally, plus the raw entries.
 *
 * BOTH, ALWAYS. The tally is what you act on; the raw list is the only way to
 * notice the tally is wrong. If someone typed "the ring my brother has" and it
 * became its own bucket, no amount of staring at counts will reveal it, but
 * one glance at the entries will.
 */

interface RawRow extends RequestRow {
  user_id: string;
  notified_at: string | null;
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("device_requests")
    .select("user_id, device_key, raw_text, notify, notified_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Couldn't load requests." }, { status: 500 });
  }

  const rows = (data ?? []) as RawRow[];

  // Attach who asked. Emails only, and only for the admin view, the tally
  // itself is anonymous and would work fine without this, but "who wants
  // Oura" is exactly the list you want on the day Oura goes live.
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  // The name lives on `profiles`, the email on `users`, two reads rather than
  // one join, because PostgREST embedding here would couple this route to the
  // FK name and buy nothing at this row count.
  const [{ data: users }, { data: profiles }] = userIds.length
    ? await Promise.all([
        supabase.from("users").select("id, email").in("id", userIds),
        supabase.from("profiles").select("user_id, full_name").in("user_id", userIds),
      ])
    : [{ data: [] }, { data: [] }];

  const nameBy = new Map(
    (profiles ?? []).map((p) => [p.user_id as string, (p.full_name as string | null) ?? null]),
  );
  const userBy = new Map(
    (users ?? []).map((u) => [
      u.id as string,
      { email: u.email as string, name: nameBy.get(u.id as string) ?? null },
    ]),
  );

  return NextResponse.json({
    tally: tallyRequests(rows),
    entries: rows.map((r) => ({
      deviceKey: r.device_key,
      rawText: r.raw_text,
      notify: r.notify,
      notifiedAt: r.notified_at,
      createdAt: r.created_at,
      email: userBy.get(r.user_id)?.email ?? null,
      name: userBy.get(r.user_id)?.name ?? null,
    })),
    // Distinct people who have asked for anything. The denominator for "6 of
    // our 14 testers want a device we don't support".
    requesterCount: userIds.length,
  });
}
