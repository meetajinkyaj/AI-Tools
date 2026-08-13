import { describe, expect, it } from "vitest";

import { auditPanelAwards, type AuditEarn, type AuditPanel } from "./points-audit";
import { POINTS } from "./points";

/**
 * The audit that would have caught a silent, total failure of the largest earn
 * in the economy. It sat undetected because nothing about it looked wrong: the
 * balance reconciled against a ledger that was itself missing the row.
 */

const panel = (over: Partial<AuditPanel> = {}): AuditPanel => ({
  id: "p1",
  user_id: "u1",
  profile_id: "prof1",
  test_date: "2026-05-12",
  created_at: "2026-07-20T10:00:00Z",
  ...over,
});

const earn = (over: Partial<AuditEarn> = {}): AuditEarn => ({
  reason: "panel_upload",
  amount: POINTS.firstPanelUpload,
  source_panel_id: "p1",
  reference_id: "p1",
  ...over,
});

describe("auditPanelAwards", () => {
  it("is quiet when every panel paid", () => {
    const out = auditPanelAwards([panel()], [earn()]);
    expect(out).toMatchObject({ panels: 1, expected: 1, matched: 1, missingPoints: 0 });
    expect(out.missing).toEqual([]);
  });

  it("names a first panel that paid nothing, and what it was owed", () => {
    // The production case: one panel, no earn anywhere in the ledger.
    const out = auditPanelAwards([panel()], []);
    expect(out.missing).toEqual([
      {
        panelId: "p1",
        userId: "u1",
        createdAt: "2026-07-20T10:00:00Z",
        testDate: "2026-05-12",
        expectedReason: "panel_upload",
        expectedAmount: POINTS.firstPanelUpload,
      },
    ]);
    expect(out.missingPoints).toBe(POINTS.firstPanelUpload);
  });

  it("matches an earn recorded only against reference_id", () => {
    // The generic credit path writes `reference_id`; the panel path adds
    // `source_panel_id`. Either identifies the panel, and an audit that knew
    // about only one of them would report a paid panel as unpaid.
    const out = auditPanelAwards([panel()], [earn({ source_panel_id: null })]);
    expect(out.matched).toBe(1);
    expect(out.missing).toEqual([]);
  });

  it("expects a re-test earn for a genuinely new date", () => {
    const out = auditPanelAwards(
      [
        panel({ id: "p1", test_date: "2026-01-10", created_at: "2026-01-11T10:00:00Z" }),
        panel({ id: "p2", test_date: "2026-05-12", created_at: "2026-05-13T10:00:00Z" }),
      ],
      [earn({ source_panel_id: "p1", reference_id: "p1" })],
    );
    expect(out.expected).toBe(2);
    expect(out.missing).toHaveLength(1);
    expect(out.missing[0]).toMatchObject({
      panelId: "p2",
      expectedReason: "retest_upload",
      expectedAmount: POINTS.reTestUpload,
    });
  });

  it("expects nothing for a re-save of a date already on file", () => {
    // Not a bug and must never be reported as one: the economy says a repeated
    // date earns nothing, so a quiet ledger there is the rule working.
    const out = auditPanelAwards(
      [
        panel({ id: "p1", created_at: "2026-07-20T10:00:00Z" }),
        panel({ id: "p2", created_at: "2026-07-21T10:00:00Z" }),
      ],
      [earn()],
    );
    expect(out.expected).toBe(1);
    expect(out.matched).toBe(1);
    expect(out.missing).toEqual([]);
  });

  it("replays in creation order, not in the order rows arrive", () => {
    // "Is this a re-test" is a question about what existed at save time. Fed
    // newest first, a naive pass would call the older panel the re-test and
    // expect the wrong amount for both.
    const out = auditPanelAwards(
      [
        panel({ id: "p2", test_date: "2026-05-12", created_at: "2026-05-13T10:00:00Z" }),
        panel({ id: "p1", test_date: "2026-01-10", created_at: "2026-01-11T10:00:00Z" }),
      ],
      [],
    );
    const byId = Object.fromEntries(out.missing.map((m) => [m.panelId, m.expectedReason]));
    expect(byId.p1).toBe("panel_upload");
    expect(byId.p2).toBe("retest_upload");
  });

  it("keeps profiles apart, so a family member's first panel is still a first panel", () => {
    const out = auditPanelAwards(
      [
        panel({ id: "p1", profile_id: "prof1" }),
        panel({ id: "p2", profile_id: "prof2", created_at: "2026-07-21T10:00:00Z" }),
      ],
      [],
    );
    expect(out.missing.map((m) => m.expectedReason)).toEqual(["panel_upload", "panel_upload"]);
  });

  it("lists the newest failure first", () => {
    // A panel that failed this week is a live bug; one from before the award
    // existed is history. The live one has to be at the top.
    const out = auditPanelAwards(
      [
        panel({ id: "old", profile_id: "a", created_at: "2026-06-01T10:00:00Z" }),
        panel({ id: "new", profile_id: "b", created_at: "2026-08-13T10:00:00Z" }),
      ],
      [],
    );
    expect(out.missing[0].panelId).toBe("new");
  });

  it("counts an earn whose panel is gone as an orphan rather than a match", () => {
    const out = auditPanelAwards([], [earn()]);
    expect(out.orphanEarns).toBe(1);
    expect(out.matched).toBe(0);
  });

  it("counts an earn the rule did not expect", () => {
    // The replay and the app disagreeing means one of them has the economy
    // wrong, which is worth knowing even though no member is short-changed.
    const out = auditPanelAwards(
      [
        panel({ id: "p1", created_at: "2026-07-20T10:00:00Z" }),
        panel({ id: "p2", created_at: "2026-07-21T10:00:00Z" }),
      ],
      [earn(), earn({ source_panel_id: "p2", reference_id: "p2" })],
    );
    expect(out.unexpected).toBe(1);
  });

  it("ignores ledger rows that are not panel earns", () => {
    const out = auditPanelAwards([panel()], [earn({ reason: "checkin", amount: 10 })]);
    expect(out.missing).toHaveLength(1);
    expect(out.orphanEarns).toBe(0);
  });
});
