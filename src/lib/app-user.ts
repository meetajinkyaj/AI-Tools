import "server-only";

import { createSupabaseAdmin } from "./supabase-admin";

/**
 * The single choke point between a verified Privy identity and the app's data:
 * resolve the users row AND enforce the beta gate. Returns null when the user
 * doesn't exist OR isn't approved — so to every data route, a waitlisted user
 * looks exactly like no user at all. The client never reaches these routes
 * while waitlisted (auth/sync routes it to the waitlist screen); this is the
 * server-side backstop against direct API calls.
 */
export async function resolveApprovedUserId(
  privyUserId: string,
): Promise<string | null> {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .select("id, access_status")
    .eq("privy_user_id", privyUserId)
    .maybeSingle();
  if (error) throw new Error(`users lookup failed: ${error.message}`);
  if (!data || data.access_status !== "approved") return null;
  return data.id;
}
