import { describe, expect, it, vi, afterEach } from "vitest";

import { PROVIDERS } from "./providers";

/**
 * Ultrahuman adapter, built against their documented payload.
 *
 * The first version of this adapter was written from assumption and was wrong
 * in almost every particular: the wrong host, the wrong query parameters, the
 * wrong scopes, a flat response shape that does not exist, and a calories field
 * their API never returns. These tests exist so that never happens silently
 * again, and the fixture below is their own documented example rather than
 * anything invented here.
 */

const fixture = {
  data: {
    metrics: {
      "2025-05-01": [
        { type: "hr", object: { title: "Heart Rate", last_reading: 63, unit: "BPM" } },
        { type: "spo2", object: { avg: 97.5, unit: "%" } },
        { type: "hrv", object: { avg: 45, unit: "ms" } },
        { type: "steps", object: { total: 180, avg: 90, unit: "steps" } },
        { type: "night_rhr", object: { avg: 48, unit: "BPM" } },
        { type: "avg_sleep_hrv", object: { value: 55 } },
        { type: "sleep_rhr", object: { value: 50 } },
        { type: "recovery_index", object: { value: 77, title: "Recovery Index" } },
        { type: "movement_index", object: { value: 85 } },
        { type: "active_minutes", object: { value: 45 } },
        { type: "vo2_max", object: { value: 42.5 } },
        { type: "sleep_score", object: { value: 85, unit: "score" } },
        { type: "total_sleep", object: { value: 25500, display_text: "7h 5m", unit: "seconds" } },
        { type: "temperature_deviation", object: { value: -0.2, unit: "°C" } },
        { type: "average_body_temperature", object: { value: 36.4, unit: "°C" } },
        { type: "glucose", object: { values: [{ timestamp: 1746057600, value: 82 }] } },
        { type: "hba1c", object: { value: 5.1 } },
      ],
    },
    latest_time_zone: "America/New_York",
  },
  error: null,
  status: "ok",
};

const uh = PROVIDERS.ultrahuman;

function mockOnce(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what we ask Ultrahuman for", () => {
  it("uses the documented scope strings, not invented ones", () => {
    // `read:metrics` / `read:sleep` were made up. These three are the real
    // vocabulary, and only two of them are ours to ask for.
    expect(uh.scopes).toEqual(["profile", "ring_data"]);
  });

  it("does not request CGM access we have nowhere to put", () => {
    // Glucose comes back on this same endpoint when granted. We store none of
    // it, and asking for data we will not use is how a consent screen stops
    // being read.
    expect(uh.scopes).not.toContain("cgm_data");
  });

  it("keeps profile scope, which is load-bearing", () => {
    // Their token response carries NO user identifier, unlike every other
    // vendor here, so /user_info is the only way to learn who connected, and
    // it needs this scope.
    expect(uh.scopes).toContain("profile");
  });

  it("knows the refresh token rotates", () => {
    // Documented explicitly. Miss it and every connection dies one refresh
    // after it appears to work.
    expect(uh.refreshRotates).toBe(true);
  });

  it("keeps the sync window short, because a day costs a request", () => {
    // This endpoint has no range form. A 7-day window would be 7 subrequests
    // per user, and the sweep does up to 50 users per invocation.
    expect(uh.syncWindowDays).toBeLessThanOrEqual(3);
  });
});

describe("reading their documented payload", () => {
  it("asks for one date at a time, with the documented parameter", async () => {
    // Typed via the generic, so `spy.mock.calls` carries a URL rather than
    // `never`, without an unused parameter to declare it.
    const spy = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response(JSON.stringify(fixture), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);

    await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-03" });

    // Three days, three calls. `start_date`/`end_date` do not exist on this API.
    expect(spy).toHaveBeenCalledTimes(3);
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("date=2025-05-01");
    expect(urls.join(" ")).not.toContain("start_date");
  });

  it("converts sleep from seconds to minutes", async () => {
    mockOnce(fixture);
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    // 25500s is 7h05m, which is 425 minutes.
    expect(out.find((m) => m.metric === "sleep_minutes")).toMatchObject({ value: 425 });
  });

  it("prefers the overnight HRV over the all-day average", async () => {
    mockOnce(fixture);
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    // avg_sleep_hrv 55, not hrv.avg 45. A recovery reading means the overnight one.
    expect(out.find((m) => m.metric === "hrv")).toMatchObject({ value: 55 });
  });

  it("takes steps from the daily total, not the per-reading average", async () => {
    mockOnce(fixture);
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    // total 180, not avg 90.
    expect(out.find((m) => m.metric === "steps")).toMatchObject({ value: 180 });
  });

  it("reads values from whichever key the entry actually uses", async () => {
    mockOnce(fixture);
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    const by = Object.fromEntries(out.map((m) => [m.metric, m.value]));
    expect(by).toMatchObject({
      resting_heart_rate: 50, // sleep_rhr.value
      readiness_score: 77, // recovery_index.value
      spo2: 97.5, // spo2.avg
      vo2max: 42.5, // vo2_max.value
      sleep_score: 85, // sleep_score.value
    });
  });

  it("keeps a negative temperature deviation negative", async () => {
    mockOnce(fixture);
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    // A deviation, not an absolute reading. Clamping it to zero would erase
    // exactly the signal it carries.
    expect(out.find((m) => m.metric === "temperature_deviation")).toMatchObject({ value: -0.2 });
  });

  it("does not invent active calories", async () => {
    mockOnce(fixture);
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    // No calories field exists in their payload. The old adapter read one.
    // `active_minutes` is minutes and is not a substitute.
    expect(out.some((m) => m.metric === "active_calories")).toBe(false);
  });

  it("stores no glucose, even though it arrives", async () => {
    mockOnce(fixture);
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    const metrics = out.map((m) => m.metric);
    for (const k of metrics) expect(k).not.toMatch(/glucose|hba1c/);
  });

  it("uses the date key from the payload, not the date requested", async () => {
    mockOnce(fixture);
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    for (const m of out) expect(m.date).toBe("2025-05-01");
  });
});

describe("awkward responses", () => {
  it("survives a day with no data instead of abandoning the window", async () => {
    // A ring on the charger produces an error or an empty day. The rest of the
    // window must still come back.
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? new Response("nope", { status: 500 })
          : new Response(JSON.stringify(fixture), { status: 200 });
      }),
    );
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-02" });
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns nothing for an empty payload rather than throwing", async () => {
    mockOnce({ data: { metrics: {} }, status: "ok" });
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    expect(out).toEqual([]);
  });

  it("ignores entries whose shape it does not recognise", async () => {
    mockOnce({ data: { metrics: { "2025-05-01": [{ type: "something_new" }, null] } } });
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    expect(out).toEqual([]);
  });
});
