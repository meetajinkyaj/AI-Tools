import "server-only";

import { getPrivyUserId } from "./api-auth";
import { createSupabaseAdmin } from "./supabase-admin";

/**
 * Admin authorization: a request is admin iff it carries a valid Privy token
 * AND the resolved user's email is on the ADMIN_EMAILS allow-list.
 *
 * Reuses the normal Privy login (no separate password to leak), and is
 * fail-closed — if ADMIN_EMAILS is unset or empty, nobody is admin. Pair with
 * Cloudflare Access on admin.ikigaro.com for a second, network-layer gate.
 */

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Returns the admin's identity, or null if the caller is not an authorized admin. */
export async function requireAdmin(
  request: Request,
): Promise<{ userId: string; email: string } | null> {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) return null;

  const allow = adminEmails();
  if (allow.size === 0) return null; // fail closed

  const supabase = createSupabaseAdmin();
  const { data: user } = await supabase
    .from("users")
    .select("id, email")
    .eq("privy_user_id", privyUserId)
    .maybeSingle();
  if (!user?.email || !allow.has(user.email.toLowerCase())) return null;

  return { userId: user.id, email: user.email };
}
