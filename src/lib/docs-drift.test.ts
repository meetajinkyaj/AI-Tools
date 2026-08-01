import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RANKS } from "./iki-rank";
import { POINTS, REFERRAL_MAX_TOTAL } from "./points";

/**
 * The hand-written docs must agree with the code they describe.
 *
 * WHY THIS EXISTS. `docs/FAQ.md` opens by calling itself "the canonical copy"
 * for the points economy. It was not: the Trends screen interpolates its copy
 * from `POINTS` and so is always right, while the FAQ is typed by hand, and it
 * sat claiming "250 points at 30 days" for weeks after that value became 150.
 * Nobody noticed, because nothing was checking. A wrong number in user-facing
 * copy about a reward is worse than a missing one.
 *
 * This test does not try to validate prose. It asserts the specific numbers a
 * reader would act on, so retuning `points.ts` without updating the docs fails
 * CI instead of shipping.
 */

const docs = (name: string) =>
  readFileSync(join(process.cwd(), "docs", name), "utf8");

const FAQ = docs("FAQ.md");
const ECONOMY = docs("POINTS_ECONOMY.md");

/** How the docs write numbers: 1,000 not 1000. */
const n = (v: number) => v.toLocaleString("en-US");

describe("docs/FAQ.md quotes the live point values", () => {
  const earns: [string, number][] = [
    ["daily check-in", POINTS.checkin],
    ["7-day streak", POINTS.streak7Bonus],
    ["30-day streak", POINTS.streak30Bonus],
    ["90-day streak", POINTS.streak90Bonus],
    ["180-day streak", POINTS.streak180Bonus],
    ["365-day streak", POINTS.streak365Bonus],
    ["first panel", POINTS.firstPanelUpload],
    ["re-test", POINTS.reTestUpload],
    ["outcome bonus per marker", POINTS.outcomeBonusPerMarker],
  ];

  for (const [label, value] of earns) {
    it(`states the ${label} value (${n(value)})`, () => {
      expect(FAQ).toContain(n(value));
    });
  }

  it("states the per-friend referral cap", () => {
    expect(FAQ).toContain(n(REFERRAL_MAX_TOTAL));
  });

  it("does not still carry the pre-revision streak numbers", () => {
    // The exact sentence that was wrong. Pinning it means the specific
    // regression cannot come back unnoticed even if the generic checks above
    // are satisfied by some other number on the page.
    expect(FAQ).not.toMatch(/250 at 30 days/);
    expect(FAQ).not.toMatch(/50 points at a 7-day streak, 250/);
  });
});

describe("the rank ladder in the docs matches the code", () => {
  const visible = RANKS.filter((r) => !r.secret);

  for (const rank of visible) {
    it(`lists ${rank.name} at ${n(rank.threshold)}`, () => {
      expect(FAQ).toContain(rank.name);
      expect(FAQ).toContain(n(rank.threshold));
    });
  }

  it("never prints the secret rank's name or threshold in user-facing copy", () => {
    // The FAQ is read by users. Naming Grandmaster or its number here would
    // give away the surprise as completely as leaking it in the UI did, and
    // that leak already happened once, in the "next rank" line.
    const secret = RANKS.find((r) => r.secret)!;
    expect(secret.id).toBe("grandmaster");
    expect(FAQ).not.toContain(secret.name);
    expect(FAQ).not.toContain(n(secret.threshold));
  });
});

describe("docs/POINTS_ECONOMY.md is the internal reference and may name everything", () => {
  it("carries every rank, including the secret one", () => {
    // The opposite rule to the FAQ: this file is for us, and a reference that
    // omits the top of the ladder cannot be used to reason about the economy.
    for (const rank of RANKS) expect(ECONOMY, rank.id).toContain(rank.name);
  });

  it("quotes the live check-in and streak values", () => {
    for (const v of [
      POINTS.checkin,
      POINTS.streak7Bonus,
      POINTS.streak30Bonus,
      POINTS.streak365Bonus,
      POINTS.firstPanelUpload,
    ]) {
      expect(ECONOMY).toContain(n(v));
    }
  });
});
