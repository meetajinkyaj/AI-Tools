import { describe, expect, it } from "vitest";

import {
  groundFor,
  isThemePreference,
  readPreference,
  THEME_PREFERENCES,
} from "./theme";

describe("groundFor", () => {
  it("follows the device on system, in both directions", () => {
    // The default, and the reason the preference is stored rather than the
    // ground: somebody on system whose phone flips at dusk flips with it.
    expect(groundFor("system", true)).toBe("dark");
    expect(groundFor("system", false)).toBe("light");
  });

  it("ignores the device once a member has chosen", () => {
    // The whole point of an override. A phone set to dark must not drag back
    // somebody who deliberately picked light.
    expect(groundFor("light", true)).toBe("light");
    expect(groundFor("dark", false)).toBe("dark");
  });

  it("only ever answers with a ground the stylesheet defines", () => {
    for (const p of THEME_PREFERENCES) {
      for (const dark of [true, false]) {
        expect(["light", "dark"]).toContain(groundFor(p, dark));
      }
    }
  });
});

describe("readPreference", () => {
  it("keeps a stored choice", () => {
    expect(readPreference("dark")).toBe("dark");
    expect(readPreference("light")).toBe("light");
    expect(readPreference("system")).toBe("system");
  });

  it("falls back to system for anything else", () => {
    // Storage is user-writable and survives across versions, so a value we
    // stopped supporting has to degrade rather than throw.
    expect(readPreference(null)).toBe("system");
    expect(readPreference("")).toBe("system");
    expect(readPreference("midnight")).toBe("system");
    expect(readPreference("DARK")).toBe("system");
  });
});

describe("isThemePreference", () => {
  it("rejects anything that is not one of the three", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(1)).toBe(false);
    expect(isThemePreference("auto")).toBe(false);
  });
});
