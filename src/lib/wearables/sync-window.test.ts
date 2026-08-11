import { describe, expect, it } from "vitest";

import { PROVIDERS } from "./providers";
import { syncWindowFor } from "./sync";

/**
 * How far back a sync asks, and why it is two numbers rather than one.
 *
 * A connection that has never synced holds no history at all, and the member is
 * usually looking at the screen when it lands. A connection that syncs nightly
 * needs only enough overlap to catch a corrected night. Using one window for
 * both means either an empty first impression or a request budget spent
 * re-fetching two months of rows we already hold, every night, for everybody.
 */

describe("syncWindowFor", () => {
  it("backfills on the first sync of a connection", () => {
    expect(syncWindowFor(PROVIDERS.whoop, { last_sync_at: null })).toBe(
      PROVIDERS.whoop.backfillWindowDays,
    );
  });

  it("takes the small window once a sync has succeeded", () => {
    expect(syncWindowFor(PROVIDERS.whoop, { last_sync_at: "2026-08-10T02:00:00Z" })).toBe(
      PROVIDERS.whoop.syncWindowDays,
    );
  });

  it("treats a missing field as a first sync", () => {
    // Some call sites build a ConnectionRow from a narrower select.
    expect(syncWindowFor(PROVIDERS.whoop, {})).toBe(PROVIDERS.whoop.backfillWindowDays);
  });

  it("changes nothing for a provider that has not declared a backfill", () => {
    // Every one of these adapters caps a page and returns a continuation token,
    // and most read the first page only. Widening their window without teaching
    // them to paginate would ask for 60 days and silently keep 25 records, which
    // is worse than the 7 days they ask for now: the data would look complete.
    for (const p of Object.values(PROVIDERS)) {
      if (p.backfillWindowDays !== undefined) continue;
      expect(syncWindowFor(p, { last_sync_at: null }), p.id).toBe(p.syncWindowDays);
    }
  });
});
