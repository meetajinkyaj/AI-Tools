import { describe, expect, it } from "vitest";

import { EXERCISE_TYPES, OTHER_TYPE } from "@/lib/exercises";
import { ActivityIcon } from "./activity-icon";

/**
 * Every selectable activity needs a glyph.
 *
 * Five of them shipped without one, because the design handoff's icon set does
 * not contain them. A tile with a label and no icon does not read as "this
 * activity has no icon", it reads as an image that failed to load, and the
 * gap is invisible to anybody whose own profile does not include those five.
 *
 * This is the check that makes adding a type to `exercises.ts` fail loudly
 * instead of quietly shipping a blank tile.
 */
describe("the icon set covers the taxonomy", () => {
  for (const type of [...EXERCISE_TYPES, OTHER_TYPE]) {
    it(`has a glyph for ${type}`, () => {
      expect(ActivityIcon({ type }), type).not.toBeNull();
    });
  }

  it("still renders nothing for a type it does not know", () => {
    // The guard that keeps a wrong picture off the screen. Null is the correct
    // answer for an unknown key; a fallback glyph would be a guess.
    expect(ActivityIcon({ type: "underwater-basket-weaving" })).toBeNull();
  });
});
