import "server-only";

import { createSupabaseAdmin } from "./supabase-admin";

/**
 * The profile layer sits between a user and their health data. Every user has
 * exactly one "self" profile (auto-created); additional profiles (parent,
 * spouse, child…) come with the multi-profile UI later. Health writes hang off
 * `profile_id`, so server code resolves the active profile here.
 *
 * For now the active profile is always the caller's self profile.
 */
export async function getOrCreateSelfProfileId(userId: string): Promise<string> {
  const supabase = createSupabaseAdmin();

  const { data: existing, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .eq("relationship", "self")
    .maybeSingle();
  if (error) throw new Error(`self profile lookup failed: ${error.message}`);
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from("profiles")
    .insert({ user_id: userId, relationship: "self" })
    .select("id")
    .single();
  if (insertError || !created) {
    throw new Error(`self profile create failed: ${insertError?.message ?? "no row"}`);
  }
  return created.id;
}
