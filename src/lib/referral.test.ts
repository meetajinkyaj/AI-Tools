import { describe, expect, it } from "vitest";

import {
  cleanReferralInput,
  generateReferralCode,
  nameBasedCode,
  normalizeReferralCode,
  RANDOM_CODE_LENGTH,
  referralLink,
} from "./referral";

describe("generateReferralCode", () => {
  it("produces codes of the right length from the safe charset", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(RANDOM_CODE_LENGTH);
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/);
    }
  });

  it("never emits confusable characters (0/O/1/I/L)", () => {
    expect(generateReferralCode(() => 0)).toBe("22222222");
    expect(generateReferralCode(() => 0.9999)).toBe("ZZZZZZZZ");
  });
});

describe("nameBasedCode", () => {
  it("uses the first name, uppercased", () => {
    expect(nameBasedCode("Ajinkya Jagtap")).toBe("AJINKYA");
  });

  it("numbers later attempts for collision retries", () => {
    expect(nameBasedCode("Ajinkya Jagtap", 1)).toBe("AJINKYA2");
    expect(nameBasedCode("Ajinkya Jagtap", 2)).toBe("AJINKYA3");
  });

  it("strips non-alphanumerics and caps at 10 chars", () => {
    expect(nameBasedCode("Anna-Marie O'Neill")).toBe("ANNAMARIE");
    expect(nameBasedCode("Krishnamurthy Iyer")).toBe("KRISHNAMUR");
  });

  it("returns null when the name is unusable (fallback to random)", () => {
    expect(nameBasedCode("Al")).toBeNull(); // too short
    expect(nameBasedCode("李 明")).toBeNull(); // no A-Z0-9 chars
    expect(nameBasedCode(null)).toBeNull();
    expect(nameBasedCode("")).toBeNull();
  });
});

describe("cleanReferralInput", () => {
  it("uppercases and strips invalid characters, keeping any length", () => {
    expect(cleanReferralInput(" fit-tr! ")).toBe("FITTR");
    expect(cleanReferralInput("ab")).toBe("AB"); // too short for a code, but shown as typed
    expect(cleanReferralInput("A".repeat(20))).toBe("A".repeat(20)); // length guarded elsewhere
  });
});

describe("normalizeReferralCode", () => {
  it("round-trips generated and name-based codes", () => {
    const random = generateReferralCode();
    expect(normalizeReferralCode(random)).toBe(random);
    expect(normalizeReferralCode("AJINKYA")).toBe("AJINKYA");
    expect(normalizeReferralCode("FITTR")).toBe("FITTR");
  });

  it("uppercases and strips separators", () => {
    expect(normalizeReferralCode(" ajinkya ")).toBe("AJINKYA");
    expect(normalizeReferralCode("fit-tr")).toBe("FITTR");
  });

  it("rejects out-of-bounds lengths and non-strings", () => {
    expect(normalizeReferralCode("AB")).toBeNull(); // too short
    expect(normalizeReferralCode("A".repeat(17))).toBeNull(); // too long
    expect(normalizeReferralCode(12345678)).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
  });
});

describe("referralLink", () => {
  it("builds the app link with the ref param", () => {
    expect(referralLink("AJINKYA")).toBe("https://app.ikigaro.com/?ref=AJINKYA");
  });
});
