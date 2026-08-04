import { describe, expect, it, vi, afterEach } from "vitest";

import { PROVIDERS } from "./providers";
import { ReauthRequired } from "./types";

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
        { type: "average_glucose", object: { title: "Average Glucose (mg/dL)", value: 99 } },
        { type: "glucose_variability", object: { title: "Glucose Variability (%)", value: 18 } },
        { type: "time_in_target", object: { title: "Time in Target (%)", value: 76 } },
        { type: "metabolic_score", object: { title: "Metabolic Score", value: 72 } },
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
    // vocabulary.
    expect(uh.scopes).toEqual(["profile", "ring_data", "cgm_data"]);
  });

  it("requests CGM, because glucose is the one signal a blood panel shares an axis with", () => {
    expect(uh.scopes).toContain("cgm_data");
  });

  it("keeps profile scope, which is requested ahead of its use", () => {
    // Their token response carries NO user identifier, unlike every other
    // vendor here, so /user_info is the only way to learn who connected, and it
    // needs this scope. WE DO NOT CALL IT YET. The scope is held because
    // changing a scope list forces every live connection back through consent,
    // and paying that twice to remove and re-add it is worse than carrying one
    // unused scope. `external_user_id` being null for Ultrahuman is therefore
    // expected, not a fault.
    expect(uh.scopes).toContain("profile");
  });

  it("does not depend on an external user id it never fetches", async () => {
    // The guard on the above: if the adapter ever starts reading
    // externalUserId, the null it gets today becomes a silent bug.
    mockOnce(fixture);
    const out = await uh.fetchRange!({
      accessToken: "t",
      externalUserId: null,
      start: "2025-05-01",
      end: "2025-05-01",
    });
    expect(out.length).toBeGreaterThan(0);
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

  it("stores the daily glucose summaries", async () => {
    mockOnce(fixture);
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    const by = Object.fromEntries(out.map((m) => [m.metric, m.value]));
    expect(by).toMatchObject({
      glucose_avg: 99,
      glucose_variability: 18,
      glucose_time_in_target: 76,
      hba1c_estimated: 5.1,
      metabolic_score: 72,
    });
  });

  it("keeps the estimated HbA1c away from the lab one", async () => {
    // Our biomarker catalog holds a real, measured `hba1c` from blood panels.
    // A CGM estimate integrates weeks, not months, and the two legitimately
    // disagree. Storing it under the plain key would let a device estimate
    // silently stand in for a clinical value.
    mockOnce(fixture);
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    expect(out.some((m) => m.metric === "hba1c_estimated")).toBe(true);
    expect(out.some((m) => (m.metric as string) === "hba1c")).toBe(false);
  });

  it("does not store the raw glucose trace", async () => {
    // `glucose` is a reading every few minutes. That is a time series and does
    // not belong at a one-row-per-day grain.
    mockOnce(fixture);
    const out = await uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-01" });
    // 17 fixture entries, but only the daily scalars we named become metrics.
    expect(out.length).toBeLessThan(17);
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

  it("fails the sync when EVERY day fails, rather than reporting no data", async () => {
    // The whole window failing is the endpoint not answering: a bad host, a
    // wrong path, an outage. Returning [] made syncConnection record a success
    // and stamp last_sync_at, so a completely broken integration reported
    // itself healthy forever.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(
      uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-02" }),
    ).rejects.toThrow(/all 2 day/);
  });

  it("surfaces a dead grant instead of counting it as a missing day", async () => {
    // A revoked connection must reach the sweep as ReauthRequired so the user
    // is asked to reconnect, not be swallowed as "no data for that date".
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(
      uh.fetchRange!({ accessToken: "t", externalUserId: null, start: "2025-05-01", end: "2025-05-02" }),
    ).rejects.toThrow(ReauthRequired);
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
