import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * The project's Supabase URL. This is public (it ships in the client bundle and
 * every API request targets it), so it is safe to commit.
 *
 * Why hardcode it: `NEXT_PUBLIC_*` values are inlined by Next.js at BUILD time.
 * On Cloudflare the Supabase URL was only set as a runtime variable, so the
 * build inlined `process.env.NEXT_PUBLIC_SUPABASE_URL` as `undefined` and this
 * client threw at runtime. Reading a plain constant (overridable at runtime via
 * `SUPABASE_URL`) removes that build-vs-runtime pitfall.
 */
const DEFAULT_SUPABASE_URL = "https://xaygldulkjjofxohescm.supabase.co";

/**
 * Server-only Supabase client using the service-role key.
 *
 * The service-role key bypasses Row Level Security, so this must NEVER be
 * imported into client code. The `server-only` import above turns any
 * accidental client import into a build error.
 */
export function createSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in the environment.");
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
