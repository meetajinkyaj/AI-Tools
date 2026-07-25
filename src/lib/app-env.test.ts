import { afterEach, describe, expect, it } from "vitest";

import { assertNotProductionDatabase, serverAppEnv } from "./app-env";

const PROD_URL = "https://xaygldulkjjofxohescm.supabase.co";
const STAGING_URL = "https://staging-project.supabase.co";
const ORIGINAL_APP_ENV = process.env.APP_ENV;

afterEach(() => {
  if (ORIGINAL_APP_ENV === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = ORIGINAL_APP_ENV;
});

describe("serverAppEnv", () => {
  it("defaults to production when unset", () => {
    delete process.env.APP_ENV;
    expect(serverAppEnv()).toBe("production");
  });

  it("treats an unrecognized value as production, never as relaxed", () => {
    process.env.APP_ENV = "stagin"; // typo
    expect(serverAppEnv()).toBe("production");
    process.env.APP_ENV = "STAGING"; // wrong case
    expect(serverAppEnv()).toBe("production");
  });

  it("recognizes the non-production environments", () => {
    process.env.APP_ENV = "staging";
    expect(serverAppEnv()).toBe("staging");
    process.env.APP_ENV = "development";
    expect(serverAppEnv()).toBe("development");
  });
});

describe("assertNotProductionDatabase", () => {
  it("throws when a non-production env would hit the production database", () => {
    // The dangerous real-world case: SUPABASE_URL forgotten on staging, so the
    // URL silently fell back to production.
    expect(() =>
      assertNotProductionDatabase(PROD_URL, PROD_URL, "staging"),
    ).toThrow(/Refusing to connect to the production database/);

    expect(() =>
      assertNotProductionDatabase(PROD_URL, PROD_URL, "development"),
    ).toThrow(/Refusing to connect/);
  });

  it("names the offending environment so the error is actionable", () => {
    expect(() =>
      assertNotProductionDatabase(PROD_URL, PROD_URL, "staging"),
    ).toThrow(/APP_ENV="staging"/);
  });

  it("allows a non-production env pointed at its own database", () => {
    expect(() =>
      assertNotProductionDatabase(STAGING_URL, PROD_URL, "staging"),
    ).not.toThrow();
  });

  it("allows production to use the production database", () => {
    expect(() =>
      assertNotProductionDatabase(PROD_URL, PROD_URL, "production"),
    ).not.toThrow();
  });
});
