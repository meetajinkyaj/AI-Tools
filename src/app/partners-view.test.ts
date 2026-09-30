import { describe, expect, it } from "vitest";

import { voucherPillar } from "./partners-view";

describe("voucherPillar", () => {
  it("files saunas and spas under Recovery", () => {
    expect(voucherPillar("Sauna & bathhouse").pillar).toBe("recovery");
  });
  it("files labs and diagnostics under Longevity", () => {
    expect(voucherPillar("Blood testing lab").pillar).toBe("longevity");
  });
  it("files gyms and training under Performance", () => {
    expect(voucherPillar("Training studio").pillar).toBe("performance");
  });
  it("falls back to a gift in the longevity hue for anything else", () => {
    expect(voucherPillar(null)).toEqual({ pillar: "longevity", icon: "gift" });
  });
});
