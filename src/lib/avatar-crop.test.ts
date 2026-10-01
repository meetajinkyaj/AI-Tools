import { describe, expect, it } from "vitest";

import { squareCrop } from "./avatar-crop";

describe("squareCrop", () => {
  it("takes the centred square of a portrait photo", () => {
    expect(squareCrop(3024, 4032)).toEqual({ sx: 0, sy: 504, size: 3024 });
  });
  it("takes the centred square of a landscape photo", () => {
    expect(squareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, size: 3000 });
  });
  it("leaves a square alone", () => {
    expect(squareCrop(512, 512)).toEqual({ sx: 0, sy: 0, size: 512 });
  });
});
