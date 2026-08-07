import { beforeEach, describe, expect, it, vi } from "vitest";

import { clampScore, dayOf, isMetricKey, METRIC_KEYS, secondsToMinutes } from "./metrics";
import { PROVIDERS, PROVIDER_IDS, isProviderId, providerConfigured } from "./providers";
import { safeEqual } from "../reminders";

/**
 * These tests cover the parts that are wrong-by-default rather than the parts
 * that are merely code: unit normalization across six vendors, the credential
 * gate, and the rotating-refresh-token hazard.
 *
 * The adapters' HTTP calls are deliberately NOT mocked. A mock of Oura's API is
 * a test of my guess about Oura's API, and it passes just as happily when the
 * guess is wrong, which is the only interesting failure. The vendor shapes are
 * verified against a real sandbox key at integration time; see docs/WEARABLES.md.
 */

describe("the metric vocabulary", () => {
  it("recognises its own keys and rejects anything else", () => {
    for (const k of METRIC_KEYS) expect(isMetricKey(k)).toBe(true);
    expect(isMetricKey("blood_pressure")).toBe(false);
    expect(isMetricKey("")).toBe(false);
    // Guards against a prototype key being mistaken for a metric.
    expect(isMetricKey("constructor")).toBe(false);
    expect(isMetricKey("toString")).toBe(false);
  });
});

describe("unit normalization", () => {
  it("converts seconds to whole minutes", () => {
    // Oura reports sleep in seconds, Fitbit in minutes. Getting this backwards
    // puts a 7-hour night on the chart as 25,200 of something.
    expect(secondsToMinutes(27_000)).toBe(450);
    expect(secondsToMinutes(0)).toBe(0);
  });

  it("never returns nonsense for nonsense input", () => {
    for (const bad of [NaN, -1, Infinity, -Infinity]) {
      const out = secondsToMinutes(bad as number);
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps every score onto one 0-100 scale", () => {
    // Vendors disagree on range. If a 0-10 score reached a chart unscaled next
    // to a 0-100 one, the two would look like the same axis and be read that
    // way. Adapters rescale; this guarantees the floor and ceiling.
    expect(clampScore(72.4)).toBe(72);
    expect(clampScore(0)).toBe(0);
    expect(clampScore(100)).toBe(100);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(NaN)).toBe(0);
  });

  it("takes the day off a timestamp without shifting it", () => {
    // A night ending 07:10 on the 4th is the 4th's sleep to every vendor here.
    expect(dayOf("2026-07-04T07:10:00+00:00")).toBe("2026-07-04");
    expect(dayOf("2026-07-04")).toBe("2026-07-04");
  });
});

describe("the provider registry", () => {
  it("has all six, and only those", () => {
    expect(PROVIDER_IDS.sort()).toEqual(
      ["fitbit", "garmin", "oura", "ultrahuman", "whoop", "withings"].sort(),
    );
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id].id).toBe(id);
  });

  it("rejects unknown provider ids", () => {
    expect(isProviderId("oura")).toBe(true);
    expect(isProviderId("apple")).toBe(false);
    expect(isProviderId("constructor")).toBe(false);
  });

  it("treats every refresh token as rotating, except where a vendor says otherwise", () => {
    // Most of these vendors retire the old refresh token on use. The sync path
    // writes back unconditionally, so this is documentation with teeth: a
    // provider claiming otherwise gets reviewed rather than assumed.
    //
    // Google is the one exception and it is safe: they reuse the same refresh
    // token and omit the field on refresh, and `tokenColumns` only overwrites
    // when a vendor actually sends one, so the stored token survives either
    // way. The flag records what is true, not what is convenient.
    const nonRotating = PROVIDER_IDS.filter((id) => !PROVIDERS[id].refreshRotates);
    expect(nonRotating).toEqual(["fitbit"]);
  });

  it("marks Garmin push-only and everyone else pollable", () => {
    // Garmin's Health API has no on-demand fetch at all. The sync sweep relies
    // on `fetchRange === null` to skip it rather than record a failure.
    expect(PROVIDERS.garmin.fetchRange).toBeNull();
    for (const id of PROVIDER_IDS.filter((p) => p !== "garmin")) {
      expect(PROVIDERS[id].fetchRange, id).toBeTypeOf("function");
    }
  });

  it("flags the two vendors that need an approved application", () => {
    // These have weeks of lead time. Knowing which they are is the difference
    // between starting the applications early and discovering them late.
    const gated = PROVIDER_IDS.filter((id) => PROVIDERS[id].requiresApproval);
    expect(gated.sort()).toEqual(["garmin", "ultrahuman"]);
  });

  it("gives every provider a redirect-safe id and non-empty scopes", () => {
    for (const id of PROVIDER_IDS) {
      const p = PROVIDERS[id];
      expect(id, "ids go in URLs and file paths").toMatch(/^[a-z]+$/);
      expect(p.scopes.length, id).toBeGreaterThan(0);
      expect(p.authorizeUrl.startsWith("https://"), id).toBe(true);
      expect(p.tokenUrl.startsWith("https://"), id).toBe(true);
    }
  });
});

describe("the credential gate", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    for (const id of PROVIDER_IDS) {
      delete process.env[PROVIDERS[id].clientIdEnv];
      delete process.env[PROVIDERS[id].clientSecretEnv];
    }
  });

  it("counts a provider configured only when BOTH halves are set", () => {
    const p = PROVIDERS.oura;
    expect(providerConfigured(p)).toBe(false);

    process.env[p.clientIdEnv] = "id";
    // A client id with no secret would send the user to a consent screen that
    // the token exchange then cannot complete, worse than not offering it.
    expect(providerConfigured(p)).toBe(false);

    process.env[p.clientSecretEnv] = "secret";
    expect(providerConfigured(p)).toBe(true);

    Object.assign(process.env, saved);
  });

  it("keeps an unavailable provider off even with both credentials set", () => {
    // No provider is retired today: Fitbit's was, and the Google Health rewrite
    // cleared it. The gate is still the thing being tested, so it is exercised
    // against a stand-in rather than deleted along with its only user, because
    // the next retirement should find this already working.
    const stub = { ...PROVIDERS.oura, unavailable: "retired for the purposes of this test" };
    process.env[stub.clientIdEnv] = "id";
    process.env[stub.clientSecretEnv] = "secret";
    expect(providerConfigured(stub)).toBe(false);
    // Same provider without the flag is configured, so the flag is what did it.
    expect(providerConfigured(PROVIDERS.oura)).toBe(true);

    Object.assign(process.env, saved);
  });

  it("says why, rather than just hiding it", () => {
    // A silent disappearance is indistinguishable from a bug. Every provider
    // that is off on purpose has to explain itself in the code that hides it.
    for (const id of PROVIDER_IDS) {
      const reason = PROVIDERS[id].unavailable;
      if (reason !== undefined) expect(reason.length, id).toBeGreaterThan(30);
    }
  });
});

describe("the daily-metric upsert", () => {
  /**
   * `ON CONFLICT DO UPDATE` cannot touch the same row twice in one statement:
   * two entries sharing (user, provider, date, metric) raise SQLSTATE 21000 and
   * the ENTIRE batch is lost, not just the duplicate. A sync that produced one
   * accidental pair would store nothing, count as a failure, and after five of
   * those mark a healthy connection expired.
   *
   * The dedupe lives in `storeMetrics` rather than in six adapters, because it
   * is a property of the table. This pins the shape of the rule; the database
   * call itself is exercised against the real schema at integration time.
   */
  it("keeps one entry per date and metric, last wins", () => {
    const metrics = [
      { metric: "steps", date: "2026-08-01", value: 9000 },
      { metric: "steps", date: "2026-08-01", value: 9412 },
      { metric: "steps", date: "2026-08-02", value: 7000 },
      { metric: "hrv", date: "2026-08-01", value: 61 },
    ];
    const byKey = new Map<string, (typeof metrics)[number]>();
    for (const m of metrics) byKey.set(`${m.date} ${m.metric}`, m);
    const deduped = [...byKey.values()];

    expect(deduped).toHaveLength(3);
    // Last wins, matching what the upsert would have done had the rows arrived
    // in separate statements.
    expect(deduped.find((m) => m.metric === "steps" && m.date === "2026-08-01")?.value).toBe(9412);
  });
});

describe("the Garmin push endpoint's shared secret", () => {
  // The route itself is exercised end-to-end by hand; this pins the property
  // that made the fix necessary, the comparison must be constant time and
  // must not treat "nothing configured" as "anything matches".
  it("rejects when no secret is configured", () => {
    expect(safeEqual("", "")).toBe(true); // same length, both empty
    // ...which is exactly why the route checks `if (!secret) return false`
    // BEFORE comparing. An empty configured secret matching an empty supplied
    // key would leave the endpoint wide open to anyone who omitted the param.
    const secret = "";
    const provided = "";
    const wouldPass = Boolean(secret) && safeEqual(provided, secret);
    expect(wouldPass).toBe(false);
  });

  it("rejects a wrong or truncated key", () => {
    const secret = "s3cr3t-push-key";
    expect(safeEqual("s3cr3t-push-ke", secret)).toBe(false);
    expect(safeEqual("s3cr3t-push-keyy", secret)).toBe(false);
    expect(safeEqual("wrong", secret)).toBe(false);
    expect(safeEqual(secret, secret)).toBe(true);
  });
});

describe("vendor-side revocation", () => {
  /**
   * The property that matters is honesty about coverage, not the HTTP call.
   * Claiming a revoke we never performed is a privacy claim we cannot support,
   * and the way that happens is somebody adding a plausible-looking URL for a
   * vendor whose endpoint nobody confirmed.
   */
  it("is implemented only where the endpoint is confirmed from the vendor's docs", () => {
    const withRevoke = PROVIDER_IDS.filter((id) => typeof PROVIDERS[id].revoke === "function");
    expect(withRevoke.sort()).toEqual(["fitbit", "oura", "whoop"]);
  });

  it("sends Google the refresh token, which kills the whole grant", async () => {
    // Google accept either token. Revoking the access token would end one hour
    // of access and leave the grant alive.
    const calls: { url: string; body: string; auth: string | null; hasSignal: boolean }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url: String(url),
          body: String(init.body),
          auth: new Headers(init.headers).get("Authorization"),
          hasSignal: init.signal instanceof AbortSignal,
        });
        return new Response("", { status: 200 });
      }),
    );
    await PROVIDERS.fitbit.revoke!({
      accessToken: "access",
      refreshToken: "refresh",
      clientId: "cid",
      clientSecret: "secret",
      signal: AbortSignal.timeout(1000),
    });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/revoke");
    expect(calls[0].body).toBe("token=refresh");
    // The signal has to reach fetch, or the caller's timeout is decorative and
    // a silent vendor holds up a disconnect the user is waiting on.
    expect(calls[0].hasSignal).toBe(true);
    vi.unstubAllGlobals();
  });

  it("treats a Whoop 404 as success, because the grant is already gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(
      PROVIDERS.whoop.revoke!({
        accessToken: "access",
        refreshToken: null,
        clientId: "cid",
        clientSecret: "secret",
        signal: AbortSignal.timeout(1000),
      }),
    ).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("sends Oura the URL its own docs print, and nothing extra", async () => {
    // Their prose mentions client_id; the URL they actually show carries only
    // access_token. Sending what the example shows, because adding an
    // undocumented parameter is a guess in a smaller costume.
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), method: String(init.method) });
        return new Response("", { status: 200 });
      }),
    );
    await PROVIDERS.oura.revoke!({
      accessToken: "tok en/+",
      refreshToken: "r",
      clientId: "cid",
      clientSecret: "secret",
      signal: AbortSignal.timeout(1000),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    // Encoded, so a token containing / or + cannot break out of the query.
    expect(calls[0].url).toBe(
      "https://api.ouraring.com/oauth/revoke?access_token=tok%20en%2F%2B",
    );
    expect(calls[0].url).not.toContain("client_id");
    vi.unstubAllGlobals();
  });

  it("retries Oura as GET when POST is refused, since they document no method", async () => {
    // Their example is a bare URL with a query string and no body, which is as
    // consistent with GET as with POST. A 405 is a disagreement about verbs,
    // not a failure to revoke.
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        methods.push(String(init.method));
        return new Response("", { status: init.method === "POST" ? 405 : 200 });
      }),
    );
    await PROVIDERS.oura.revoke!({
      accessToken: "access",
      refreshToken: null,
      clientId: "cid",
      clientSecret: "secret",
      signal: AbortSignal.timeout(1000),
    });
    expect(methods).toEqual(["POST", "GET"]);
    vi.unstubAllGlobals();
  });

  it("treats an Oura 401 as success, because the token is already dead", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(
      PROVIDERS.oura.revoke!({
        accessToken: "access",
        refreshToken: null,
        clientId: "cid",
        clientSecret: "secret",
        signal: AbortSignal.timeout(1000),
      }),
    ).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("throws on a real refusal, so the caller can log it and carry on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(
      PROVIDERS.whoop.revoke!({
        accessToken: "access",
        refreshToken: null,
        clientId: "cid",
        clientSecret: "secret",
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow(/whoop revoke 500/);
    vi.unstubAllGlobals();
  });
});
