import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import {
  auditPanelAwards,
  PANEL_EARN_REASONS,
  type AuditEarn,
  type AuditPanel,
} from "@/lib/points-audit";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/admin/points-audit
 *
 * Every lab panel on file, checked against the ledger: did the earn it was owed
 * actually get written?
 *
 * WHY THIS ROUTE EXISTS. The panel-upload award, 200 points and the largest
 * single earn in the economy, had never written a row in production and nothing
 * in the app could tell. Balances reconciled, because they reconciled against a
 * ledger that was itself missing the earn; the report rendered; no error was
 * raised anywhere. The only way to see it was to ask the database whether rows
 * that should exist do, which is what this does.
 *
 * NO HEALTH DATA LEAVES HERE. Panel ids, dates and owners, never a marker or a
 * value: the same rule the CSV export holds. What is being audited is the
 * economy, not the medicine.
 *
 * Admin-only, read-only, and deliberately not paginated. At beta scale this is
 * a few hundred rows; when it stops being, the missing list gets a limit long
 * before the counts do.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  try {
    const supabase = createSupabaseAdmin();

    const [{ data: panels, error: panelError }, { data: earns, error: earnError }] =
      await Promise.all([
        supabase
          .from("biomarker_panels")
          .select("id, user_id, profile_id, test_date, created_at"),
        supabase
          .from("points_transactions")
          .select("reason, amount, source_panel_id, reference_id")
          .in("reason", [...PANEL_EARN_REASONS]),
      ]);

    if (panelError) throw new Error(`biomarker_panels select failed: ${panelError.message}`);
    if (earnError) throw new Error(`points_transactions select failed: ${earnError.message}`);

    const audit = auditPanelAwards(
      (panels ?? []) as AuditPanel[],
      (earns ?? []) as AuditEarn[],
    );

    /*
     * Emails for the flagged panels only.
     *
     * Two reasons not to join them in: the audit is about panels and does not
     * need identities to reach its answer, and pulling every member's email to
     * annotate a list that is usually empty is a privacy cost with no return.
     * When the list is not empty, an admin needs to know who to make whole.
     */
    const flaggedUserIds = [...new Set(audit.missing.map((m) => m.userId))];
    const emailById = new Map<string, string>();
    if (flaggedUserIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, email")
        .in("id", flaggedUserIds);
      for (const u of users ?? []) emailById.set(u.id as string, (u.email as string) ?? "");
    }

    return NextResponse.json({
      ...audit,
      missing: audit.missing.map((m) => ({ ...m, email: emailById.get(m.userId) ?? null })),
    });
  } catch (err) {
    console.error("GET /api/admin/points-audit failed:", err);
    return NextResponse.json({ error: "Failed to audit points" }, { status: 500 });
  }
}
