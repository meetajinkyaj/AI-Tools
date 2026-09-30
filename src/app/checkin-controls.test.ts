import { describe, expect, it } from "vitest";

import { MAX_ENERGY, MIN_ENERGY } from "@/lib/checkin";
import {
  energyAtRatio,
  HOLD_MS,
  pillarForActivity,
  SLEEP_MAX,
  SLEEP_MIN,
  SLEEP_START,
  stepSleep,
  thumbPercent,
} from "./checkin-controls";

/**
 * The drag maths, without a DOM.
 *
 * Everything else in the energy slider is the browser doing its job: pointer
 * capture keeps the gesture, and the CSS fills the cells. This function is the
 * only part that can be quietly wrong, and wrong here means somebody's finger
 * is over the 4 while the app records a 3.
 *
 * v2 made the control a thumb that sits on five stops (0, 25, 50, 75, 100%),
 * so the value is the NEAREST stop, where v1's five cells each owned a fifth.
 */
describe("energyAtRatio", () => {
  it("snaps to the nearest of the five stops", () => {
    expect(energyAtRatio(0.0)).toBe(1);
    expect(energyAtRatio(0.12)).toBe(1);
    expect(energyAtRatio(0.13)).toBe(2);
    expect(energyAtRatio(0.25)).toBe(2);
    expect(energyAtRatio(0.5)).toBe(3);
    expect(energyAtRatio(0.74)).toBe(4);
    expect(energyAtRatio(0.88)).toBe(5);
    expect(energyAtRatio(1)).toBe(MAX_ENERGY);
  });

  it("puts the thumb exactly on the stop it reports", () => {
    for (let v = MIN_ENERGY; v <= MAX_ENERGY; v += 1) {
      expect(energyAtRatio(thumbPercent(v) / 100)).toBe(v);
    }
    expect(thumbPercent(MIN_ENERGY)).toBe(0);
    expect(thumbPercent(MAX_ENERGY)).toBe(100);
  });

  it("pins rather than wraps when the finger leaves either end", () => {
    // Pointer capture means the gesture keeps reporting after the finger has
    // left the track, so both of these happen on any real drag.
    expect(energyAtRatio(-0.4)).toBe(MIN_ENERGY);
    expect(energyAtRatio(-50)).toBe(MIN_ENERGY);
    expect(energyAtRatio(1.4)).toBe(MAX_ENERGY);
    expect(energyAtRatio(50)).toBe(MAX_ENERGY);
  });

  it("never returns a value outside the scale, for any input", () => {
    for (let r = -2; r <= 2; r += 0.017) {
      const v = energyAtRatio(r);
      expect(v, String(r)).toBeGreaterThanOrEqual(MIN_ENERGY);
      expect(v, String(r)).toBeLessThanOrEqual(MAX_ENERGY);
      expect(Number.isInteger(v), String(r)).toBe(true);
    }
  });
});

describe("sleep stepper", () => {
  it("starts at a sensible value on the first tap, either way", () => {
    expect(stepSleep(null, 1)).toBe(SLEEP_START);
    expect(stepSleep(null, -1)).toBe(SLEEP_START);
  });

  it("moves in half hours and stays inside the range", () => {
    expect(stepSleep(7, 1)).toBe(7.5);
    expect(stepSleep(7.5, -1)).toBe(7);
    expect(stepSleep(SLEEP_MAX, 1)).toBe(SLEEP_MAX);
    expect(stepSleep(SLEEP_MIN, -1)).toBe(SLEEP_MIN);
  });

  it("snaps a typed odd value onto the half-hour grid", () => {
    expect(stepSleep(7.2, 1)).toBe(7.5);
  });
});

describe("activity pillar", () => {
  it("files mobility under Recovery and training under Performance", () => {
    expect(pillarForActivity("yoga_mobility")).toBe("recovery");
    expect(pillarForActivity("gym")).toBe("performance");
    expect(pillarForActivity("other")).toBe("performance");
  });
});

describe("hold to check in", () => {
  it("holds for the handoff's 600ms", () => {
    expect(HOLD_MS).toBe(600);
  });
});
