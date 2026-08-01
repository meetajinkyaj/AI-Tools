import { describe, expect, it } from "vitest";

import {
  assessBackupRisk,
  BACKUP_REVIEW_THRESHOLD,
  declaredBackupPosture,
} from "./backup-risk";

describe("declaredBackupPosture, fails safe", () => {
  it("only the explicit string counts as protected", () => {
    expect(declaredBackupPosture("protected")).toBe("protected");
    expect(declaredBackupPosture("  PROTECTED  ")).toBe("protected");
  });

  it("treats anything else as unprotected, including nothing at all", () => {
    // The whole point. A missing or misspelled variable must not be read as
    // "backups exist", wrongly warning costs a moment's annoyance, wrongly
    // staying quiet costs every user's health data.
    for (const value of [
      undefined,
      "",
      "   ",
      "none",
      "true",
      "yes",
      "enabled",
      "protcted",
      "1",
    ]) {
      expect(declaredBackupPosture(value), JSON.stringify(value)).toBe("none");
    }
  });
});

describe("assessBackupRisk", () => {
  it("stays quiet once backups actually exist", () => {
    const risk = assessBackupRisk(5000, "protected");
    expect(risk.overdue).toBe(false);
    expect(risk.accepted).toBe(false);
  });

  it("is accepted-but-noted below the threshold", () => {
    const risk = assessBackupRisk(3, "none");
    expect(risk.accepted).toBe(true);
    expect(risk.overdue).toBe(false);
    expect(risk.headroom).toBe(BACKUP_REVIEW_THRESHOLD - 3);
  });

  it("trips exactly at the threshold, not one past it", () => {
    expect(assessBackupRisk(BACKUP_REVIEW_THRESHOLD - 1, "none").overdue).toBe(false);
    expect(assessBackupRisk(BACKUP_REVIEW_THRESHOLD, "none").overdue).toBe(true);
    expect(assessBackupRisk(BACKUP_REVIEW_THRESHOLD + 1, "none").overdue).toBe(true);
  });

  it("never reports both states at once", () => {
    for (const users of [0, 1, 19, 20, 21, 1000]) {
      const risk = assessBackupRisk(users, "none");
      expect(risk.accepted && risk.overdue).toBe(false);
    }
  });

  it("never promises negative headroom", () => {
    expect(assessBackupRisk(500, "none").headroom).toBe(0);
  });

  it("degrades safely on a nonsense count", () => {
    // An analytics hiccup must not be able to silence the warning.
    for (const users of [NaN, Infinity, -5, -1]) {
      const risk = assessBackupRisk(users, "none");
      expect(risk.users).toBeGreaterThanOrEqual(0);
      expect(risk.accepted || risk.overdue).toBe(true);
    }
  });
});
