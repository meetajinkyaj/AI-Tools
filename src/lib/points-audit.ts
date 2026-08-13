import { uploadEarn } from "./points";

/**
 * Did every lab panel that should have paid points actually pay them?
 *
 * WHY THIS EXISTS. On 2026-08-13 a ledger read showed that the panel-upload
 * award, 200 points and the largest single earn in the economy, had never
 * written a row in production. Not for one member: for anybody, ever. The
 * balance and the lifetime score both reconciled to the point, because they
 * reconciled against a ledger that was itself missing the earn. Every number in
 * the app agreed with every other number, and the award was still absent.
 *
 * That is the shape of failure this file is for. A missing earn leaves no error
 * anywhere: the panel saves, the report renders, the balance is internally
 * consistent, and the only trace is a number that was never added. It cannot be
 * caught by testing the award path, because the award path is fine; it is
 * caught by asking the database whether the rows that should exist do.
 *
 * HOW IT DECIDES. By replaying `uploadEarn`, the same pure rule the app uses at
 * save time, over the panels as stored, in the order they were created, and
 * comparing the answer to the ledger. Not a second implementation of the
 * economy: the same function, so the audit cannot drift from the thing it
 * audits.
 *
 * ONE KNOWN FALSE POSITIVE, stated rather than hidden. A panel whose readings
 * exactly match an earlier one is a replay and earns nothing by design. The
 * save path normally collapses those before a row is written, so they rarely
 * reach the database, but a panel that slipped through would be reported here
 * as missing an earn it was never owed. Comparing reading content would rule it
 * out and costs a query per flagged panel; it is not worth it until the report
 * is noisy, and it will not be noisy while the answer is zero.
 */

export interface AuditPanel {
  id: string;
  user_id: string;
  profile_id: string;
  test_date: string | null;
  created_at: string;
}

export interface AuditEarn {
  reason: string;
  amount: number;
  /** Set by the panel award path. */
  source_panel_id: string | null;
  /** The generic `referenceId`, also the panel id for these earns. */
  reference_id: string | null;
}

export interface MissingAward {
  panelId: string;
  userId: string;
  createdAt: string;
  testDate: string | null;
  expectedReason: string;
  expectedAmount: number;
}

export interface PanelAwardAudit {
  /** Panels examined. */
  panels: number;
  /** Of those, the ones the rule says should have earned something. */
  expected: number;
  /** Expected earns that are present in the ledger. */
  matched: number;
  /** Expected earns that are not, newest first. */
  missing: MissingAward[];
  /**
   * Ledger rows claiming to pay for a panel that is not in the set examined.
   * A deleted panel explains most of these; anything else is worth a look.
   */
  orphanEarns: number;
  /**
   * Earns against a panel the rule says should NOT have earned. Harmless to a
   * member and interesting to us: it means the replay and the app disagree, so
   * one of them has the economy wrong.
   */
  unexpected: number;
  /** Total points the missing earns represent. */
  missingPoints: number;
}

/** Which panel a ledger row is paying for, if any. */
function panelIdOf(earn: AuditEarn): string | null {
  return earn.source_panel_id ?? earn.reference_id ?? null;
}

export const PANEL_EARN_REASONS = ["panel_upload", "retest_upload"] as const;

export function isPanelEarnReason(reason: string): boolean {
  return (PANEL_EARN_REASONS as readonly string[]).includes(reason);
}

export function auditPanelAwards(
  panels: readonly AuditPanel[],
  earns: readonly AuditEarn[],
): PanelAwardAudit {
  const earnByPanel = new Map<string, AuditEarn>();
  let orphanEarns = 0;
  const panelIds = new Set(panels.map((p) => p.id));

  for (const e of earns) {
    if (!isPanelEarnReason(e.reason)) continue;
    const id = panelIdOf(e);
    if (!id || !panelIds.has(id)) {
      orphanEarns += 1;
      continue;
    }
    earnByPanel.set(id, e);
  }

  /*
   * Grouped per profile and replayed oldest first, because "is this a re-test"
   * is a question about what already existed when this panel was saved. A
   * profile's second panel is only a re-test relative to its first; ordering by
   * anything other than creation time answers a different question.
   */
  const byProfile = new Map<string, AuditPanel[]>();
  for (const p of panels) {
    const list = byProfile.get(p.profile_id) ?? [];
    list.push(p);
    byProfile.set(p.profile_id, list);
  }

  let expected = 0;
  let matched = 0;
  let unexpected = 0;
  const missing: MissingAward[] = [];

  for (const list of byProfile.values()) {
    const ordered = [...list].sort((a, b) =>
      a.created_at === b.created_at
        ? a.id.localeCompare(b.id)
        : a.created_at.localeCompare(b.created_at),
    );
    const priorTestDates: (string | null)[] = [];

    for (const panel of ordered) {
      const earn = uploadEarn(panel.test_date, priorTestDates);
      priorTestDates.push(panel.test_date);

      const paid = earnByPanel.get(panel.id);
      if (!earn) {
        if (paid) unexpected += 1;
        continue;
      }
      expected += 1;
      if (paid) {
        matched += 1;
      } else {
        missing.push({
          panelId: panel.id,
          userId: panel.user_id,
          createdAt: panel.created_at,
          testDate: panel.test_date,
          expectedReason: earn.reason,
          expectedAmount: earn.amount,
        });
      }
    }
  }

  // Newest first: a panel that failed to pay this week is a live bug, one from
  // before the award shipped is history.
  missing.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    panels: panels.length,
    expected,
    matched,
    missing,
    orphanEarns,
    unexpected,
    missingPoints: missing.reduce((sum, m) => sum + m.expectedAmount, 0),
  };
}
