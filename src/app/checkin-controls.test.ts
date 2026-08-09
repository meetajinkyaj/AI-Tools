import { describe, expect, it } from "vitest";

import { MAX_ENERGY, MIN_ENERGY } from "@/lib/checkin";
import { energyAtRatio } from "./checkin-controls";

/**
 * The drag maths, without a DOM.
 *
 * Everything else in the energy slider is the browser doing its job: pointer
 * capture keeps the gesture, and the CSS fills the cells. This function is the
 * only part that can be quietly wrong, and wrong here means somebody's finger
 * is over the 4 while the app records a 3.
 */
describe("energyAtRatio", () => {
  it("puts each fifth of the track on its own value", () => {
    expect(energyAtRatio(0.0)).toBe(1);
    expect(energyAtRatio(0.19)).toBe(1);
    expect(energyAtRatio(0.2)).toBe(2);
    expect(energyAtRatio(0.5)).toBe(3);
    expect(energyAtRatio(0.79)).toBe(4);
    expect(energyAtRatio(0.8)).toBe(5);
    expect(energyAtRatio(0.99)).toBe(5);
  });

  it("gives the last cell the same width as the others", () => {
    // Exactly 1.0 is the right edge and would land on a sixth cell without the
    // clamp. A slider whose top value is reachable only by one pixel less than
    // the end is a slider you cannot set to its top value with a thumb.
    expect(energyAtRatio(1)).toBe(MAX_ENERGY);
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
