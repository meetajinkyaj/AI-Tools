import "server-only";

import { type CatalogEntry, dedupeCatalogForSex } from "./biomarkers";
import { createSupabaseAdmin } from "./supabase-admin";

/**
 * Shared server-side data access for the biomarker report: resolve the app user
 * (and their biological sex) from a Privy id, and load the sex-appropriate
 * catalog. Used by both the report save route and the PDF-extract route.
 */

export async function resolveReportUser(
  privyUserId: string,
): Promise<{ userId: string; sex: string } | null> {
  const supabase = createSupabaseAdmin();
  const { data: user, error } = await supabase
    .from("users")
    .select("id")
    .eq("privy_user_id", privyUserId)
    .maybeSingle();
  if (error) throw new Error(`users lookup failed: ${error.message}`);
  if (!user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("biological_sex")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(`profiles lookup failed: ${profileError.message}`);

  return { userId: user.id, sex: profile?.biological_sex ?? "any" };
}

export async function loadReportCatalog(sex: string): Promise<CatalogEntry[]> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("biomarker_catalog")
    .select(
      "marker_key, display_name, category, unit, sex, ref_low, ref_high, direction, sort_order, result_kind, is_derived, normal_text, bands",
    )
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`biomarker_catalog select failed: ${error.message}`);
  return dedupeCatalogForSex((data ?? []) as CatalogEntry[], sex);
}
