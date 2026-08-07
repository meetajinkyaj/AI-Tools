import { describe, expect, it, vi, afterEach } from "vitest";

import { googleTemperatureDeviation, PROVIDERS } from "./providers";

/**
 * Oura and Fitbit, checked against their published documentation.
 *
 * Third and fourth of the four adapters written from assumption in one sitting.
 * The first two audited (Ultrahuman, Whoop) were both wrong, and both of these
 * are too, in the same shape: a field read from the wrong place, so the metric
 * was never emitted and nothing failed.
 */

const range = { accessToken: "t", externalUserId: null, start: "2026-08-01", end: "2026-08-01" };

/** Routes a stubbed fetch by URL fragment, since one sync hits several paths. */
function route(map: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const hit = Object.entries(map).find(([frag]) => u.includes(frag));
      return new Response(JSON.stringify(hit ? hit[1] : { data: [], sleep: [] }), { status: 200 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ Oura ---- */

const oura = PROVIDERS.oura;

describe("Oura scopes", () => {
  it("asks for spo2, without which blood oxygen never arrives", () => {
    // The bug: `spo2` gates its own collection and was not requested at all.
    expect(oura.scopes).toContain("spo2");
  });

  it("does not ask for the member's gender, age, height and weight", () => {
    // That is what `personal` returns, and we call no personal endpoint.
    expect(oura.scopes).not.toContain("personal");
  });

  it("uses only scope strings Oura actually publishes", () => {
    const real = ["email", "personal", "daily", "heartrate", "workout", "tag", "session", "spo2"];
    for (const s of oura.scopes) expect(real, s).toContain(s);
  });
});

describe("Oura blood oxygen", () => {
  it("reads spo2 from its own collection, not from the sleep document", async () => {
    // `spo2_percentage` does not exist on `/sleep`. Reading it there meant the
    // metric was silently never produced.
    route({
      "/daily_spo2": { data: [{ day: "2026-08-01", spo2_percentage: { average: 96.5 } }] },
      "/sleep": { data: [] },
    });
    const out = await oura.fetchRange!(range);
    expect(out.find((m) => m.metric === "spo2")).toMatchObject({ value: 96.5, date: "2026-08-01" });
  });

  it("asks the daily_spo2 endpoint at all", async () => {
    const spy = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);
    await oura.fetchRange!(range);
    expect(spy.mock.calls.map((c) => String(c[0])).join(" ")).toContain("/daily_spo2");
  });
});

describe("Oura, the parts that were already right", () => {
  it("keys a night to the morning it ended, not the evening it began", async () => {
    route({
      "/sleep?": {
        data: [
          {
            day: "2026-08-01",
            bedtime_end: "2026-08-02T07:10:00+00:00",
            total_sleep_duration: 25_500,
            average_hrv: 55,
            lowest_heart_rate: 48,
          },
        ],
      },
    });
    const out = await oura.fetchRange!({ ...range, end: "2026-08-02" });
    const sleep = out.find((m) => m.metric === "sleep_minutes");
    // 25500s is 7h05m, and it belongs to the 2nd, the morning of waking.
    expect(sleep).toMatchObject({ value: 425, date: "2026-08-02" });
  });
});

describe("Oura stress, cardiovascular age and VO2 max", () => {
  /**
   * Shapes taken from Oura's generated v2 schemas, not invented: `daily_stress`
   * carries `stress_high` and `recovery_high` in SECONDS,
   * `daily_cardiovascular_age` carries `vascular_age` in years, and `vO2_max`
   * carries `vo2_max` under a path capitalised exactly that way.
   */
  it("converts the stress zones from seconds to minutes", async () => {
    route({
      "/daily_stress": {
        data: [{ day: "2026-08-01", stress_high: 5_400, recovery_high: 12_600 }],
      },
    });
    const out = await oura.fetchRange!(range);
    const by = Object.fromEntries(out.map((m) => [m.metric, m.value]));
    expect(by.stress_high_minutes).toBe(90);
    expect(by.recovery_high_minutes).toBe(210);
  });

  it("reads vascular age and VO2 max", async () => {
    route({
      "/daily_cardiovascular_age": { data: [{ day: "2026-08-01", vascular_age: 34 }] },
      "/vO2_max": { data: [{ day: "2026-08-01", vo2_max: 47.2 }] },
    });
    const out = await oura.fetchRange!(range);
    const by = Object.fromEntries(out.map((m) => [m.metric, m.value]));
    expect(by.vascular_age).toBe(34);
    expect(by.vo2max).toBe(47.2);
  });

  it("SURVIVES A 403 ON AN OPTIONAL COLLECTION WITHOUT KILLING THE CONNECTION", async () => {
    // The whole reason these three are fetched defensively. Oura's newer portal
    // grants Stress and Heart Health separately and their OAuth scope strings
    // are undocumented. providerFetch turns 403 into ReauthRequired, which the
    // sweep treats as a dead grant, so an ungranted optional scope would ask the
    // member to reconnect over one absent metric.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        const optional =
          u.includes("daily_stress") ||
          u.includes("cardiovascular") ||
          u.includes("vO2_max");
        if (optional) return new Response("", { status: 403 });
        return new Response(
          JSON.stringify({ data: [{ day: "2026-08-01", score: 71 }] }),
          { status: 200 },
        );
      }),
    );
    const out = await oura.fetchRange!(range);
    // The baseline still lands, and nothing throws.
    expect(out.some((m) => m.metric === "sleep_score")).toBe(true);
    expect(out.some((m) => m.metric === "vascular_age")).toBe(false);
  });

  it("still fails loudly when a REQUIRED collection 403s", async () => {
    // A genuinely revoked grant must still reach the sweep as ReauthRequired.
    // The optional catch must not have swallowed that too.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(oura.fetchRange!(range)).rejects.toThrow();
  });
});

describe("Oura workouts", () => {
  /** Shape from Oura's generated v2 workout schema. */
  const workout = {
    id: "8f9e1c2b-0000-4a11-9b33-abcdef123456",
    activity: "cycling",
    calories: 412,
    day: "2026-08-01",
    distance: 18_240.5,
    end_datetime: "2026-08-01T18:12:00+05:30",
    intensity: "moderate",
    source: "manual",
    start_datetime: "2026-08-01T17:05:00+05:30",
  };

  it("requests the workout scope, which is on Oura's published list", () => {
    expect(oura.scopes).toContain("workout");
  });

  it("reads a session without converting calories, which are already kcal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [workout] }), { status: 200 })),
    );
    const out = await oura.fetchWorkouts!(range);
    expect(out[0]).toMatchObject({
      externalId: workout.id,
      activity: "cycling",
      intensity: "moderate",
      calories: 412,
      distanceM: 18_240.5,
      date: "2026-08-01",
    });
  });

  it("trusts Oura's own day rather than re-deriving it from the timestamp", async () => {
    // A late-evening session in a positive offset is theirs to attribute. The
    // timestamp is the 1st at 22:40 local, which is the 31st in UTC.
    const late = {
      ...workout,
      day: "2026-08-01",
      start_datetime: "2026-08-01T22:40:00+05:30",
      end_datetime: "2026-08-01T23:30:00+05:30",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [late] }), { status: 200 })),
    );
    const out = await oura.fetchWorkouts!(range);
    expect(out[0].date).toBe("2026-08-01");
  });

  it("skips a record with no id, which could not be upserted anyway", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ ...workout, id: undefined }] }), { status: 200 }),
      ),
    );
    expect(await oura.fetchWorkouts!(range)).toEqual([]);
  });

  it("emits no strain, which is a Whoop concept", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [workout] }), { status: 200 })),
    );
    const out = await oura.fetchWorkouts!(range);
    expect(out[0].strain).toBeUndefined();
  });
});

/* ========================================================================== */
/* Fitbit, via the Google Health API                                          */
/* ========================================================================== */

/**
 * Written against Google's discovery document
 * (`health.googleapis.com/$discovery/rest?version=v4`, revision 20260805),
 * which disagrees with their own migration prose in several places. These
 * tests pin the disagreements, because each one is a silent-empty-metric bug
 * of the kind that has caught four adapters in this repo.
 */

const fitbit = PROVIDERS.fitbit;

/** Records every request so a test can assert on paths, filters and bodies. */
function captureFetch(byFragment: Record<string, unknown> = {}) {
  const calls: { url: string; method: string; body: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const u = String(url);
      calls.push({
        url: u,
        method: String(init.method ?? "GET"),
        body: init.body ? String(init.body) : null,
      });
      const hit = Object.entries(byFragment).find(([frag]) => u.includes(frag));
      return new Response(JSON.stringify(hit ? hit[1] : {}), { status: 200 });
    }),
  );
  return calls;
}

const gd = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
};

describe("Google Health OAuth", () => {
  it("points at Google, not Fitbit", () => {
    // The member signs in with a Google account. A Fitbit login appears
    // nowhere in this flow.
    expect(fitbit.authorizeUrl).toContain("accounts.google.com");
    expect(fitbit.tokenUrl).toBe("https://oauth2.googleapis.com/token");
  });

  it("asks for offline access, without which there is no refresh token at all", () => {
    // Google issues no refresh token unless access_type=offline, and sends one
    // exactly once per grant unless prompt=consent forces a reissue. Miss
    // either and the connection works for an hour and then dies silently.
    expect(fitbit.extraAuthParams).toMatchObject({
      access_type: "offline",
      prompt: "consent",
    });
  });

  it("requests three scopes, all read-only", () => {
    expect(fitbit.scopes).toHaveLength(3);
    for (const s of fitbit.scopes) {
      expect(s).toMatch(/^https:\/\/www\.googleapis\.com\/auth\/googlehealth\./);
      expect(s).toMatch(/\.readonly$/);
    }
    // Four legacy scopes collapsed into this one bundle, so heart rate, SpO2,
    // respiratory rate and temperature now arrive or refuse together.
    expect(fitbit.scopes).toContain(
      "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    );
  });

  it("does not claim Google rotates refresh tokens, because it does not", () => {
    // Google reuses the same refresh token and omits the field on refresh.
    // Claiming rotation would be harmless here only because tokenColumns
    // refuses to blank a token the vendor did not send.
    expect(fitbit.refreshRotates).toBe(false);
  });
});

describe("Google Health daily collections", () => {
  it("uses kebab-case in the path and snake_case in the filter", () => {
    // Google's spec really does want both spellings of one data type in a
    // single request. Getting it uniform either way returns nothing.
    const calls = captureFetch();
    return fitbit.fetchRange!(range).then(() => {
      const hrv = calls.find((c) => c.url.includes("daily-heart-rate-variability"));
      expect(hrv, "path should be kebab-case").toBeTruthy();
      expect(decodeURIComponent(hrv!.url)).toContain("daily_heart_rate_variability.date");
    });
  });

  it("asks for a closed-open range, so the last day is not dropped", async () => {
    const calls = captureFetch();
    await fitbit.fetchRange!(range);
    const hrv = calls.find((c) => c.url.includes("daily-heart-rate-variability"))!;
    const filter = decodeURIComponent(hrv.url);
    expect(filter).toContain('>= "2026-08-01"');
    // end is 2026-08-01, so the exclusive bound is the next day.
    expect(filter).toContain('< "2026-08-02"');
  });

  it("reads the daily metrics off their own shapes", async () => {
    captureFetch({
      "daily-resting-heart-rate": {
        dataPoints: [{ dailyRestingHeartRate: { beatsPerMinute: "54", date: gd("2026-08-01") } }],
      },
      "daily-heart-rate-variability": {
        dataPoints: [
          {
            dailyHeartRateVariability: {
              averageHeartRateVariabilityMilliseconds: 61.5,
              date: gd("2026-08-01"),
            },
          },
        ],
      },
      "daily-oxygen-saturation": {
        dataPoints: [{ dailyOxygenSaturation: { averagePercentage: 96.4, date: gd("2026-08-01") } }],
      },
      "daily-respiratory-rate": {
        dataPoints: [{ dailyRespiratoryRate: { breathsPerMinute: 14.2, date: gd("2026-08-01") } }],
      },
      "daily-vo2-max": {
        dataPoints: [{ dailyVo2Max: { vo2Max: 46.1, date: gd("2026-08-01") } }],
      },
    });
    const out = await fitbit.fetchRange!(range);
    const at = (m: string) => out.find((x) => x.metric === m)?.value;
    // beatsPerMinute is an int64, which JSON carries as a STRING.
    expect(at("resting_heart_rate")).toBe(54);
    expect(at("hrv")).toBe(61.5);
    expect(at("spo2")).toBe(96.4);
    expect(at("respiratory_rate")).toBe(14.2);
    expect(at("vo2max")).toBe(46.1);
  });

  it("survives one collection being refused without losing the others", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("daily-oxygen-saturation")) {
          return new Response("nope", { status: 403 });
        }
        if (String(url).includes("daily-resting-heart-rate")) {
          return new Response(
            JSON.stringify({
              dataPoints: [
                { dailyRestingHeartRate: { beatsPerMinute: "51", date: gd("2026-08-01") } },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const out = await fitbit.fetchRange!(range);
    expect(out.find((m) => m.metric === "resting_heart_rate")?.value).toBe(51);
    expect(out.some((m) => m.metric === "spo2")).toBe(false);
  });
});

describe("Google Health skin temperature, the Whoop trap in a new coat", () => {
  it("subtracts the baseline rather than publishing an absolute reading", () => {
    // Legacy Fitbit sent a value that was already a deviation. Google sends
    // roughly 33 degrees plus a baseline, and publishing the first as a
    // deviation would put a body temperature on a chart of fractions.
    expect(googleTemperatureDeviation(33.4, 33.1)).toBe(0.3);
    expect(googleTemperatureDeviation(32.8, 33.1)).toBe(-0.3);
  });

  it("reports nothing when there is no baseline to subtract", () => {
    expect(googleTemperatureDeviation(33.4, undefined)).toBeUndefined();
    expect(googleTemperatureDeviation(undefined, 33.1)).toBeUndefined();
  });

  it("emits the difference, not the raw nightly value", async () => {
    captureFetch({
      "daily-sleep-temperature-derivations": {
        dataPoints: [
          {
            dailySleepTemperatureDerivations: {
              nightlyTemperatureCelsius: 33.6,
              baselineTemperatureCelsius: 33.2,
              date: gd("2026-08-01"),
            },
          },
        ],
      },
    });
    const out = await fitbit.fetchRange!(range);
    expect(out.find((m) => m.metric === "temperature_deviation")?.value).toBe(0.4);
  });
});

describe("Google Health sleep", () => {
  it("filters on end time, which is the one session type Google excludes", async () => {
    // Sleep is explicitly excluded from the civil-start-time filter every
    // other session type uses, and wants RFC-3339 on interval.end_time.
    const calls = captureFetch();
    await fitbit.fetchRange!(range);
    const sleep = calls.find((c) => c.url.includes("/sleep/dataPoints"))!;
    const filter = decodeURIComponent(sleep.url);
    expect(filter).toContain("sleep.interval.end_time");
    expect(filter).toContain('>= "2026-08-01T00:00:00Z"');
  });

  it("dates a night by the morning it ended", async () => {
    captureFetch({
      "/sleep/dataPoints": {
        dataPoints: [
          {
            sleep: {
              summary: { minutesAsleep: "431" },
              metadata: { mainSleep: true, nap: false },
              interval: {
                startTime: "2026-07-31T22:40:00Z",
                endTime: "2026-08-01T06:15:00Z",
                civilEndTime: { date: gd("2026-08-01") },
              },
            },
          },
        ],
      },
    });
    const out = await fitbit.fetchRange!(range);
    const sleep = out.find((m) => m.metric === "sleep_minutes");
    expect(sleep?.value).toBe(431);
    expect(sleep?.date).toBe("2026-08-01");
  });

  it("skips naps, which would otherwise overwrite a whole night", async () => {
    // The upsert is keyed on (user, provider, date, metric), so a 20 minute
    // nap sharing a day with the night would silently replace it. Two adapters
    // in this repo shipped exactly that bug.
    captureFetch({
      "/sleep/dataPoints": {
        dataPoints: [
          {
            sleep: {
              summary: { minutesAsleep: "22" },
              metadata: { nap: true },
              interval: {
                startTime: "2026-08-01T14:00:00Z",
                endTime: "2026-08-01T14:22:00Z",
                civilEndTime: { date: gd("2026-08-01") },
              },
            },
          },
        ],
      },
    });
    const out = await fitbit.fetchRange!(range);
    expect(out.some((m) => m.metric === "sleep_minutes")).toBe(false);
  });

  it("publishes no sleep score, because Google Health exposes none", async () => {
    captureFetch({
      "/sleep/dataPoints": {
        dataPoints: [
          {
            sleep: {
              summary: { minutesAsleep: "400", minutesInSleepPeriod: "440" },
              metadata: { mainSleep: true },
              interval: {
                startTime: "2026-07-31T23:00:00Z",
                endTime: "2026-08-01T06:20:00Z",
                civilEndTime: { date: gd("2026-08-01") },
              },
            },
          },
        ],
      },
    });
    const out = await fitbit.fetchRange!(range);
    // Efficiency is derivable and means something different from Oura's score.
    expect(out.some((m) => m.metric === "sleep_score")).toBe(false);
  });
});

describe("Google Health rollups", () => {
  it("POSTs dailyRollUp with a capital U, which their own guide gets wrong", async () => {
    const calls = captureFetch();
    await fitbit.fetchRange!(range);
    const steps = calls.find((c) => c.url.includes("/steps/dataPoints"))!;
    expect(steps.url).toContain(":dailyRollUp");
    expect(steps.url).not.toContain(":dailyRollup");
    expect(steps.method).toBe("POST");
    expect(JSON.parse(steps.body!)).toMatchObject({
      range: { start: { date: gd("2026-08-01") }, end: { date: gd("2026-08-02") } },
      windowSizeDays: 1,
    });
  });

  it("reads steps and active calories off their rollup values", async () => {
    captureFetch({
      "/steps/dataPoints": {
        rollupDataPoints: [{ civilStartTime: { date: gd("2026-08-01") }, steps: { countSum: "9412" } }],
      },
      "/active-energy-burned/dataPoints": {
        rollupDataPoints: [
          { civilStartTime: { date: gd("2026-08-01") }, activeEnergyBurned: { kcalSum: 612.5 } },
        ],
      },
    });
    const out = await fitbit.fetchRange!(range);
    expect(out.find((m) => m.metric === "steps")?.value).toBe(9412);
    expect(out.find((m) => m.metric === "active_calories")?.value).toBe(612.5);
  });
});

describe("Google Health exercise", () => {
  const exercise = (over: Record<string, unknown> = {}, source?: Record<string, unknown>) => ({
    name: "users/me/dataTypes/exercise/dataPoints/abc123",
    dataSource: { recordingMethod: "ACTIVELY_MEASURED", platform: "FITBIT", ...source },
    exercise: {
      displayName: "Run",
      exerciseType: "RUNNING",
      interval: {
        startTime: "2026-08-01T07:00:00Z",
        endTime: "2026-08-01T07:35:00Z",
        civilStartTime: { date: gd("2026-08-01") },
      },
      metricsSummary: {
        caloriesKcal: 340,
        distanceMillimeters: 5_000_000,
        averageHeartRateBeatsPerMinute: "148",
      },
      ...over,
    },
  });

  it("converts distance from MILLIMETRES", async () => {
    // Google report millimetres. Reading them as metres would turn a 5km run
    // into 5,000km and nothing would fail.
    captureFetch({ "/exercise/dataPoints": { dataPoints: [exercise()] } });
    const out = await fitbit.fetchWorkouts!(range);
    expect(out[0].distanceM).toBe(5000);
    expect(out[0].calories).toBe(340);
    expect(out[0].avgHeartRate).toBe(148);
    expect(out[0].externalId).toBe("users/me/dataTypes/exercise/dataPoints/abc123");
  });

  it("reads recordingMethod as the auto-detected signal", async () => {
    // Better than the legacy API, which needed a string match on logType.
    captureFetch({
      "/exercise/dataPoints": {
        dataPoints: [
          exercise({ displayName: "Walk" }, { recordingMethod: "PASSIVELY_MEASURED" }),
        ],
      },
    });
    const out = await fitbit.fetchWorkouts!(range);
    expect(out[0].autoDetected).toBe(true);
  });

  it("does not treat an unstated recording method as auto-detected", async () => {
    // False means "they do not say", never "we know it was deliberate", which
    // is the rule every other provider follows.
    for (const method of ["ACTIVELY_MEASURED", "MANUAL", "UNKNOWN", "RECORDING_METHOD_UNSPECIFIED"]) {
      captureFetch({
        "/exercise/dataPoints": { dataPoints: [exercise({}, { recordingMethod: method })] },
      });
      const out = await fitbit.fetchWorkouts!(range);
      expect(out[0].autoDetected, method).toBe(false);
    }
  });

  it("falls back to a stable id when Google names no data point", async () => {
    const e = exercise();
    delete (e as Record<string, unknown>).name;
    captureFetch({ "/exercise/dataPoints": { dataPoints: [e] } });
    const out = await fitbit.fetchWorkouts!(range);
    // Start plus type: a member cannot begin two runs at the same instant.
    expect(out[0].externalId).toBe("2026-08-01T07:00:00Z:RUNNING");
  });

  it("survives a null entry and one with no interval", async () => {
    captureFetch({
      "/exercise/dataPoints": {
        dataPoints: [null, { exercise: { displayName: "Broken" } }, exercise()],
      },
    });
    const out = await fitbit.fetchWorkouts!(range);
    expect(out).toHaveLength(1);
  });
});
