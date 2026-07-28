import { describe, expect, it } from "vitest";

import {
  ACCELERATED_MULTIPLIER,
  ACCELERATED_REASONS,
  accelerateAwards,
  applyMultiplier,
  effectiveMultiplier,
  isAcceleratedReason,
  MAX_MULTIPLIER,
  totalAccelerated,
} from "./accelerated-points";
import { computeAwards } from "./checkin";
import { POINTS, POINTS_REASON, uploadEarn } from "./points";

describe("which earns accelerate", () => {
  /**
   * Driven from the functions that actually build awards, NOT from
   * POINTS_REASON. That distinction caught a real bug: the check-in path emits
   * `"streak_bonus"`, while POINTS_REASON declares `streak7: "streak_7_bonus"`
   * — a constant nothing writes. A list validated against POINTS_REASON passed
   * happily while streak bonuses would never have been accelerated at all.
   */
  it("accelerates every reason the check-in path can emit", () => {
    for (const streak of [1, 7, 30, 100]) {
      for (const award of computeAwards(streak)) {
        expect(
          isAcceleratedReason(award.reason),
          `computeAwards(${streak}) emits "${award.reason}"`,
        ).toBe(true);
      }
    }
  });

  it("accelerates every reason the panel-upload path can emit", () => {
    const first = uploadEarn("2026-01-01", []);
    const retest = uploadEarn("2026-04-01", ["2026-01-01"]);
    for (const earn of [first, retest]) {
      expect(earn, "expected an earn").not.toBeNull();
      expect(isAcceleratedReason(earn!.reason), earn!.reason).toBe(true);
    }
  });

  it("accelerates the outcome bonus", () => {
    expect(isAcceleratedReason(POINTS_REASON.outcomeBonus)).toBe(true);
  });

  it("never accelerates a referral milestone", () => {
    // These pay a referrer for someone ELSE's behaviour. Doubling them rewards
    // recruiting rather than health, and gives partner users a permanently
    // better rate at farming signups than everyone else.
    for (const reason of [
      POINTS_REASON.referralOnboard,
      POINTS_REASON.referralStreak,
      POINTS_REASON.referralPanel,
    ]) {
      expect(isAcceleratedReason(reason), reason).toBe(false);
    }
  });

  it("lists no reason that nothing actually emits", () => {
    // The inverse guard. A stale entry here is dead weight that reads as
    // coverage — exactly how "streak_7_bonus" looked correct while the ledger
    // was receiving "streak_bonus".
    const emitted = new Set<string>([
      ...[1, 7, 30].flatMap((s) => computeAwards(s).map((a) => a.reason)),
      uploadEarn("2026-01-01", [])!.reason,
      uploadEarn("2026-04-01", ["2026-01-01"])!.reason,
      POINTS_REASON.outcomeBonus,
    ]);
    for (const reason of ACCELERATED_REASONS) {
      expect(emitted.has(reason), `nothing emits "${reason}"`).toBe(true);
    }
  });

  it("treats an unknown reason as ineligible", () => {
    // A new earn must be classified on purpose. Defaulting to 1x is visibly
    // stingy and safe; defaulting the other way would overpay forever.
    expect(isAcceleratedReason("some_future_bonus")).toBe(false);
  });
});

describe("effectiveMultiplier", () => {
  const now = new Date("2026-07-28T12:00:00Z");

  it("is 1 for an ordinary user", () => {
    expect(effectiveMultiplier({ points_multiplier: 1 }, now)).toBe(1);
    expect(effectiveMultiplier(null, now)).toBe(1);
    expect(effectiveMultiplier(undefined, now)).toBe(1);
    expect(effectiveMultiplier({}, now)).toBe(1);
  });

  it("reads a numeric that PostgREST returned as a string", () => {
    // Postgres `numeric` arrives as a STRING over the wire. Left unparsed,
    // amount * "2" is NaN and the user silently earns nothing.
    expect(effectiveMultiplier({ points_multiplier: "2" }, now)).toBe(2);
    expect(effectiveMultiplier({ points_multiplier: "2.0" }, now)).toBe(2);
  });

  it("honours an unexpired window, and stops at expiry", () => {
    const user = {
      points_multiplier: 2,
      multiplier_expires_at: "2026-08-01T00:00:00Z",
    };
    expect(effectiveMultiplier(user, now)).toBe(2);
    expect(effectiveMultiplier(user, new Date("2026-08-01T00:00:00Z"))).toBe(1);
    expect(effectiveMultiplier(user, new Date("2026-09-01T00:00:00Z"))).toBe(1);
  });

  it("treats an unreadable expiry as expired, not as forever", () => {
    expect(
      effectiveMultiplier(
        { points_multiplier: 2, multiplier_expires_at: "not-a-date" },
        now,
      ),
    ).toBe(1);
  });

  it("never lets bad data pay MORE than the normal rate", () => {
    // Paying the normal rate on nonsense is a visible disappointment. Paying an
    // inflated one is points in circulation that cannot be taken back.
    for (const bad of [NaN, Infinity, -Infinity, -5, 0, 0.5, "abc", null]) {
      expect(
        effectiveMultiplier({ points_multiplier: bad as never }, now),
        String(bad),
      ).toBe(1);
    }
  });

  it("clamps above the ceiling rather than trusting the row", () => {
    expect(effectiveMultiplier({ points_multiplier: 999 }, now)).toBe(MAX_MULTIPLIER);
  });
});

describe("applyMultiplier", () => {
  it("doubles at the accelerated rate", () => {
    expect(applyMultiplier(POINTS.checkin, ACCELERATED_MULTIPLIER)).toBe(20);
    expect(applyMultiplier(POINTS.firstPanelUpload, ACCELERATED_MULTIPLIER)).toBe(400);
  });

  it("leaves an ordinary user untouched", () => {
    expect(applyMultiplier(10, 1)).toBe(10);
    expect(applyMultiplier(10, 0)).toBe(10);
  });

  it("rounds down, never up", () => {
    // Whole points everywhere else in the economy; a fraction would leak into
    // balances, voucher thresholds and the shared card.
    expect(applyMultiplier(15, 1.5)).toBe(22); // 22.5 -> 22
    expect(applyMultiplier(10, 1.15)).toBe(11); // 11.5 -> 11
    expect(Number.isInteger(applyMultiplier(7, 1.3))).toBe(true);
  });

  it("degrades to zero rather than NaN on nonsense", () => {
    expect(applyMultiplier(NaN, 2)).toBe(0);
    expect(applyMultiplier(10, NaN)).toBe(0);
  });
});

describe("accelerateAwards", () => {
  // Built from the real producer, not hand-written from POINTS_REASON. A
  // hand-written fixture is how the phantom "streak_7_bonus" got into the
  // eligibility list in the first place.
  const checkinDay7 = computeAwards(7);

  it("doubles a partner user's check-in day", () => {
    const out = accelerateAwards(checkinDay7, 2);
    expect(out.map((a) => a.amount)).toEqual([20, 100]);
    expect(totalAccelerated(out)).toBe(120);
  });

  it("leaves an ordinary user's day exactly as it was", () => {
    const out = accelerateAwards(checkinDay7, 1);
    expect(out.map((a) => a.amount)).toEqual(checkinDay7.map((a) => a.amount));
    expect(out.every((a) => a.multiplier === 1)).toBe(true);
  });

  it("accelerates eligible earns while leaving referrals alone in the same batch", () => {
    const mixed = [
      { amount: POINTS.checkin, reason: POINTS_REASON.checkin },
      { amount: POINTS.referralOnboard, reason: POINTS_REASON.referralOnboard },
    ];
    const out = accelerateAwards(mixed, 2);
    expect(out[0].amount).toBe(20);
    expect(out[0].multiplier).toBe(2);
    expect(out[1].amount).toBe(POINTS.referralOnboard);
    expect(out[1].multiplier).toBe(1);
  });

  it("records the multiplier and the base on every row", () => {
    // The ledger has to explain itself: a 20-point check-in beside a 10-point
    // one is otherwise a support ticket nobody can answer.
    const [row] = accelerateAwards([{ amount: 10, reason: POINTS_REASON.checkin }], 2);
    expect(row).toEqual({
      reason: POINTS_REASON.checkin,
      baseAmount: 10,
      amount: 20,
      multiplier: 2,
    });
  });

  it("keeps the ledger arithmetic honest", () => {
    // amount must always equal baseAmount x multiplier, rounded down.
    for (const m of [1, 1.5, 2, 3]) {
      for (const award of checkinDay7) {
        const [row] = accelerateAwards([award], m);
        expect(row.amount).toBe(applyMultiplier(row.baseAmount, row.multiplier));
      }
    }
  });

  it("handles an empty batch", () => {
    expect(accelerateAwards([], 2)).toEqual([]);
    expect(totalAccelerated([])).toBe(0);
  });
});
