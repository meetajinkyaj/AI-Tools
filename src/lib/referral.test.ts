import { describe, expect, it } from "vitest";

import {
  CODE_LENGTH,
  generateReferralCode,
  normalizeReferralCode,
  referralLink,
} from "./referral";

describe("generateReferralCode", () => {
  it("produces codes of the right length from the safe charset", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/);
    }
  });

  it("never emits confusable characters (0/O/1/I/L)", () => {
    // Force the extremes of the charset via a stubbed RNG.
    expect(generateReferralCode(() => 0)).toBe("22222222");
    expect(generateReferralCode(() => 0.9999)).toBe("ZZZZZZZZ");
  });
});

describe("normalizeReferralCode", () => {
  it("round-trips a generated code", () => {
    const code = generateReferralCode();
    expect(normalizeReferralCode(code)).toBe(code);
  });

  it("uppercases and strips separators", () => {
    expect(normalizeReferralCode(" ab23-cd45 ")).toBe("AB23CD45");
  });

  it("rejects wrong lengths, confusables, and non-strings", () => {
    expect(normalizeReferralCode("SHORT")).toBeNull();
    expect(normalizeReferralCode("O0O0O0O0")).toBeNull(); // confusable chars
    expect(normalizeReferralCode(12345678)).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
  });
});

describe("referralLink", () => {
  it("builds the app link with the ref param", () => {
    expect(referralLink("AB23CD45")).toBe("https://app.ikigaro.com/?ref=AB23CD45");
  });
});
