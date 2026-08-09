import "server-only";

import { createSupabaseAdmin } from "../supabase-admin";
import { isMetricFamily, type MetricFamily, type SourcePreferences } from "./merge";
import { isProviderId } from "./providers";

/**
 * Reading and writing a member's chosen device per metric family.
 *
 * ONE READER, DELIBERATELY. Four routes merge the same rows: Trends, the
 * training card, Future You and the per-device panel. If any of them merges
 * without the member's preferences, that screen quietly disagrees with the
 * others, and the disagreement is invisible because both numbers are real
 * readings from real devices. So every call site loads them the same way, from
 * here, and `mergeMetrics` says so in its own documentation.
 *
 * WHY IT IS NOT CACHED. It is one indexed read by primary key, returning at
 * most four rows, alongside queries that already read hundreds. A cache here
 * would buy nothing and would introduce the one bug this module exists to
 * prevent: two screens, two answers.
 */

/**
 * A member's preferences, or an empty object.
 *
 * NEVER THROWS. A failure to read a preference must not empty somebody's
 * Trends page: the default ranking is a correct answer, just not their
 * preferred one, so a broken read degrades to the default rather than to
 * nothing. The error is logged because a silently failing preference is a
 * support ticket that reads "the app keeps forgetting my choice".
 */
export async function loadSourcePreferences(userId: string): Promise<SourcePreferences> {
  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("wearable_source_preferences")
      .select("family, provider")
      .eq("user_id", userId);

    if (error) {
      console.error("source preference read failed:", error);
      return {};
    }

    const out: SourcePreferences = {};
    for (const row of data ?? []) {
      const family = row.family as string;
      const provider = row.provider as string;
      // Both are free text in the database so that adding a family or retiring
      // a provider is a code change rather than a migration. The cost is that
      // an unrecognised value has to be inert here rather than fatal.
      if (isMetricFamily(family) && isProviderId(provider)) out[family] = provider;
    }
    return out;
  } catch (err) {
    console.error("source preference read failed:", err);
    return {};
  }
}

/**
 * Set or clear one family's source.
 *
 * `provider === null` deletes the row, which returns that family to the default
 * ranking. Clearing is a real choice and not a failure to choose: somebody who
 * has decided they would rather we picked should be able to say so, and leaving
 * a stale preference behind after they disconnect the device it names would
 * point at a device that no longer exists.
 */
export async function setSourcePreference(
  userId: string,
  family: MetricFamily,
  provider: string | null,
): Promise<void> {
  const supabase = createSupabaseAdmin();

  if (provider === null) {
    const { error } = await supabase
      .from("wearable_source_preferences")
      .delete()
      .eq("user_id", userId)
      .eq("family", family);
    if (error) throw new Error(`clearing ${family} preference failed: ${error.message}`);
    return;
  }

  const { error } = await supabase.from("wearable_source_preferences").upsert(
    {
      user_id: userId,
      family,
      provider,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,family" },
  );
  if (error) throw new Error(`saving ${family} preference failed: ${error.message}`);
}

/**
 * Drop any preference naming a provider the member is no longer connected to.
 *
 * Called on disconnect. Without it, somebody who picks their Whoop for sleep
 * and later disconnects it keeps a preference pointing at nothing: harmless to
 * the merge, which simply never matches it, and confusing on the settings
 * screen, which would show a choice they cannot see the device for.
 */
export async function pruneSourcePreferences(
  userId: string,
  connected: readonly string[],
): Promise<void> {
  try {
    const supabase = createSupabaseAdmin();
    const { data } = await supabase
      .from("wearable_source_preferences")
      .select("family, provider")
      .eq("user_id", userId);

    const stale = (data ?? [])
      .filter((r) => !connected.includes(r.provider as string))
      .map((r) => r.family as string);
    if (stale.length === 0) return;

    await supabase
      .from("wearable_source_preferences")
      .delete()
      .eq("user_id", userId)
      .in("family", stale);
  } catch (err) {
    // Best effort. A stale preference is untidy; a disconnect that fails
    // because of tidying is a member still connected to an app they left.
    console.warn("pruning source preferences failed:", err);
  }
}
