import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { lifestyleLine } from "./doctor-summary";

/**
 * The doctor summary is the one screen in this app that leaves it.
 *
 * A member hands the PDF to a clinician, who reads it as a medical document
 * because that is what it looks like. Everything on it therefore has to earn
 * its place clinically, and the app's own engagement mechanics do not: a streak
 * exists to make somebody open the app tomorrow, and printing it beside a lipid
 * panel lends it an authority it has not got.
 *
 * These tests exist because that boundary is easy to cross by accident. Adding
 * a badge, a rank or a points total to "lifestyle context" would look like an
 * improvement in a diff and would be a regression on the page.
 */

describe("lifestyleLine", () => {
  it("carries the two self-reported averages", () => {
    const out = lifestyleLine({ avgEnergy: 4, avgSleep: 7.2, checkinCount: 20 }, " · ");
    expect(out).toContain("Avg energy 4/5");
    expect(out).toContain("Avg sleep 7.2h");
  });

  it("qualifies them with the observation period, which is the sample size", () => {
    // "Energy 4/5" over twenty days and over two days are different claims, and
    // a clinician cannot weigh the first without knowing which it is.
    expect(lifestyleLine({ avgEnergy: 4, avgSleep: 7.2, checkinCount: 20 }, " · ")).toContain(
      "self-reported over 20 days",
    );
  });

  it("says day rather than days when there is one", () => {
    expect(lifestyleLine({ avgEnergy: 3, avgSleep: 6, checkinCount: 1 }, " · ")).toContain(
      "self-reported over 1 day",
    );
  });

  it("says nothing about a period when there is no self-report at all", () => {
    const out = lifestyleLine({ avgEnergy: null, avgSleep: null, checkinCount: 0 }, " · ");
    expect(out).not.toContain("self-reported");
    expect(out).toBe("Avg energy -/5 · Avg sleep -");
  });

  it("never mentions streaks or check-ins", () => {
    const out = lifestyleLine({ avgEnergy: 4, avgSleep: 7.2, checkinCount: 20 }, " · ");
    expect(out.toLowerCase()).not.toContain("streak");
    expect(out.toLowerCase()).not.toContain("check-in");
  });
});

describe("the doctor summary carries no app gamification", () => {
  /**
   * Read from the source rather than from a rendered output, because the risk
   * is a NEW line being added rather than this one changing. A test of
   * `lifestyleLine` cannot see a streak somebody puts in the header.
   */
  const source = readFileSync(join(process.cwd(), "src/app/doctor-summary.tsx"), "utf8");

  /**
   * Comments are stripped first.
   *
   * The file EXPLAINS why the streak is not on this document, which means it
   * has to say the word, the same bind `no-em-dash.test.ts` is in. Banning the
   * word everywhere would mean the reason for the rule could not be written
   * down next to the rule, and an undocumented rule is one somebody undoes.
   */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // Each entry is a mechanic that exists to drive app usage. None of them
  // describes the body, so none belongs on a document a doctor reads.
  for (const term of ["streak", "iki_score", "ikiScore", "points_balance", "rank"]) {
    it(`does not render ${term}`, () => {
      expect(code.toLowerCase()).not.toContain(term.toLowerCase());
    });
  }
});
