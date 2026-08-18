import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROVIDERS, polarSeconds, polarSteps } from "./providers";
import { clearRateLimits, parseRateLimit } from "./rate-limit";

/**
 * Polar, checked against their AccessLink Dynamic API v4 swagger.
 *
 * WHY THE FIXTURES LOOK LIKE THIS. Every field name and every example value
 * below is copied out of Polar's own `swagger.yaml`, not invented. That matters
 * more here than for most vendors, because v4 is not the API anybody writes
 * tutorials about: the whole internet documents v3, whose hosts, endpoints,
 * transaction model and mandatory user-registration step are all different, and
 * code lifted from a v3 example fails against a v4 client in ways that read as
 * our bug.
 *
 * NOTHING HERE HAS RUN AGAINST A LIVE POLAR ACCOUNT. Credentials exist, so the
 * first real connect is the real test; these tests pin what the spec says, and
 * that is a weaker claim.
 */

const polar = PROVIDERS.polar;

let calls: string[] = [];

/** Answer by URL, so one call can serve four different endpoints in order. */
function mockByPath(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const href = String(url);
      calls.push(href);
      const key = Object.keys(routes).find((k) => href.includes(k));
      return new Response(JSON.stringify(key ? routes[key] : {}), { status: 200 });
    }),
  );
}

beforeEach(() => {
  calls = [];
  clearRateLimits();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("v4, not v3", () => {
  it("uses the OAuth hosts the v4 spec names, not the ones in Polar's own v3 example", () => {
    /*
     * THE TOKEN URL IS THE TRAP. Polar's published example application, and
     * every community client derived from it, post to
     * `https://polarremote.com/v2/oauth2/token`. That is v3. The v4 swagger's
     * `securityDefinitions` names `auth.polar.com` for both, and a token
     * exchange sent to the wrong host fails at the one moment a member is
     * watching a spinner.
     */
    expect(polar.authorizeUrl).toBe("https://auth.polar.com/oauth/authorize");
    expect(polar.tokenUrl).toBe("https://auth.polar.com/oauth/token");
    expect(polar.tokenUrl).not.toContain("polarremote.com");
  });

  it("sends client credentials as Basic auth, which their spec requires", () => {
    expect(polar.tokenAuth).toBe("basic");
  });

  it("asks for five scopes and none of the ones that carry personal data", () => {
    expect(polar.scopes).toEqual([
      "activity:read",
      "sleep:read",
      "nightly_recharge:read",
      "continuous_samples:read",
      "training_sessions:read",
    ]);
    // profile:read grants the member's email address, which we already hold.
    // A scope we do not use is a scope we should not be trusted with.
    for (const unwanted of [
      "profile:read",
      "ppi_data:read",
      "routes:read",
      "skin_contact:read",
      "calendar:read",
    ]) {
      expect(polar.scopes).not.toContain(unwanted);
    }
  });

  it("calls the v4 data host from the spec's own servers entry", async () => {
    mockByPath({});
    await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    for (const url of calls) {
      expect(url.startsWith("https://www.polaraccesslink.com/v4/data/")).toBe(true);
    }
  });

  it("makes no user-registration call, because v4 has no such endpoint", async () => {
    /*
     * v3 required `POST /users` after the token exchange and failed every read
     * without it, which is the single most-reported Polar gotcha. There is no
     * such path anywhere in the v4 spec. Carrying the v3 workaround forward
     * would send a POST to a URL that does not exist.
     */
    mockByPath({});
    await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(calls.some((u) => /\/users\b/.test(u))).toBe(false);
  });
});

describe("the features trap", () => {
  /*
   * Their words, on nearly every endpoint: "Without features the response
   * contains only the dates where data is available", and "if features are used,
   * only one day at a time can be requested". So the obvious call, a wide range
   * with no features, returns a list of dates and no numbers. An adapter built
   * on it stores nothing while looking perfectly healthy.
   */

  it("always sends features, or the response carries no data at all", async () => {
    mockByPath({});
    await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) expect(url).toContain("features=");
  });

  it("asks one day at a time, because features caps a request at one day", async () => {
    mockByPath({});
    await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-15",
      end: "2026-08-17",
    });
    // Three days, three endpoints each.
    expect(calls).toHaveLength(9);
    for (const day of ["2026-08-15", "2026-08-16", "2026-08-17"]) {
      expect(calls.filter((u) => u.includes(`from=${day}`))).toHaveLength(3);
    }
  });

  it("treats `to` as exclusive, so one day means tomorrow's date", async () => {
    // Every v4 endpoint documents `to` as the exclusive end. Sending the same
    // date for both would ask for an empty interval and quietly return nothing.
    mockByPath({});
    await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(calls[0]).toContain("from=2026-08-17");
    expect(calls[0]).toContain("to=2026-08-18");
  });

  it("repeats the features key rather than comma-joining it", async () => {
    // The swagger says `collectionFormat: multi`. A comma list is one feature
    // named "sleep-evaluation,sleep-score", which is not a feature.
    mockByPath({});
    await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    const sleep = calls.find((u) => u.includes("/sleeps"))!;
    expect(sleep).toContain("features=sleep-evaluation");
    expect(sleep).toContain("features=sleep-score");
    expect(sleep).not.toContain("%2C");
  });

  it("does not set a backfill window, because a day per request makes it costly", () => {
    /*
     * Ninety days of history exists, and reaching it is 90 requests per data
     * type per member. Four data types is 360 calls for one member's first
     * sync, against an app-wide budget of 3,000 per fifteen minutes. Eight
     * members connecting in one afternoon would exhaust it.
     */
    expect(polar.backfillWindowDays).toBeUndefined();
    expect(polar.syncWindowDays).toBe(7);
  });

  it("refuses to turn a mistaken range into hundreds of requests", async () => {
    mockByPath({});
    await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2020-01-01",
      end: "2026-08-17",
    });
    // 31 days is the cap, three endpoints each.
    expect(calls).toHaveLength(93);
  });
});

describe("durations are strings", () => {
  /*
   * `"80s"`, or `"3.000000001s"` at full precision. `Number("80s")` is NaN, and
   * a NaN reaching `push` is dropped, so getting this wrong presents as sleep
   * that simply never appears rather than as an error anyone would notice.
   */
  it("parses their format, including fractional seconds", () => {
    expect(polarSeconds("80s")).toBe(80);
    expect(polarSeconds("3.000000001s")).toBeCloseTo(3, 6);
    expect(polarSeconds("0s")).toBe(0);
  });

  it("returns undefined rather than NaN for anything else", () => {
    for (const bad of ["", "80", "s", "eighty seconds", null, undefined, {}, "80m"]) {
      expect(polarSeconds(bad), String(bad)).toBeUndefined();
    }
  });

  it("accepts a bare number, in case they ever send one", () => {
    expect(polarSeconds(80)).toBe(80);
  });
});

describe("sleep, from the spec's own shape", () => {
  const sleepFixture = {
    nightSleeps: [
      {
        sleepDate: "2026-08-17",
        sleepScore: { sleepScore: 82 },
        sleepEvaluation: {
          // 7h 30m asleep inside an 8h 20m span.
          asleepDuration: "27000s",
          sleepSpan: "30000s",
          phaseDurations: {
            wake: "3000s",
            rem: "5400s",
            light: "14400s",
            deep: "7200s",
            unknown: "0s",
          },
        },
      },
    ],
  };

  it("takes asleepDuration and not sleepSpan", async () => {
    /*
     * THE DECISION THIS TEST PROTECTS. Polar report both, and the difference is
     * exactly the distinction our own screen makes: `sleep_minutes` is defined
     * to the member as time actually asleep, which reads lower than time in bed.
     * `sleepSpan` is time in bed. 27000s is 450 minutes; the span would be 500,
     * and a member comparing against Polar Flow would find our number wrong by
     * fifty minutes in the flattering direction.
     */
    mockByPath({ "/sleeps": sleepFixture });
    const metrics = await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(metrics).toContainEqual({
      metric: "sleep_minutes",
      date: "2026-08-17",
      value: 450,
      source: "polar",
    });
    expect(metrics.some((m) => m.metric === "sleep_minutes" && m.value === 500)).toBe(false);
  });

  it("keeps their sleep score as-is, because it is already a 1-100 scale", async () => {
    mockByPath({ "/sleeps": sleepFixture });
    const metrics = await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(metrics).toContainEqual({
      metric: "sleep_score",
      date: "2026-08-17",
      value: 82,
      source: "polar",
    });
  });

  it("stores nothing for a night with no evaluation rather than a zero", async () => {
    // A member whose device synced the date but not the analysis must not get a
    // zero-minute night, which reads as insomnia rather than as missing data.
    mockByPath({ "/sleeps": { nightSleeps: [{ sleepDate: "2026-08-17" }] } });
    const metrics = await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(metrics.some((m) => m.metric.startsWith("sleep"))).toBe(false);
  });
});

describe("nightly recharge", () => {
  const rechargeFixture = {
    nightlyRechargeResults: [
      {
        sleepResultDate: "2026-08-17",
        meanNightlyRecoveryRmssd: 62,
        meanNightlyRecoveryRri: 1100,
        meanNightlyRecoveryRespirationInterval: 4200,
        recoveryIndicator: 4,
        recoveryIndicatorSubLevel: 55,
        ansStatus: 1.4,
      },
    ],
  };

  it("maps RMSSD straight onto hrv, because that is the same quantity", async () => {
    // Oura and WHOOP report RMSSD in milliseconds too, which is the whole
    // reason these three can share one axis. This is a rename, not a
    // conversion.
    mockByPath({ "/nightly-recharge-results": rechargeFixture });
    const metrics = await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(metrics).toContainEqual({
      metric: "hrv",
      date: "2026-08-17",
      value: 62,
      source: "polar",
    });
  });

  it("converts the respiration interval to breaths per minute", async () => {
    // 4200ms between breaths is 60000/4200 = 14.3 breaths a minute.
    mockByPath({ "/nightly-recharge-results": rechargeFixture });
    const metrics = await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(metrics).toContainEqual({
      metric: "respiratory_rate",
      date: "2026-08-17",
      value: 14.3,
      source: "polar",
    });
  });

  it("DROPS a respiration figure outside what a sleeping human produces", async () => {
    /*
     * Their spec's own example for this field is 800, which converts to 75
     * breaths a minute: plainly a placeholder copied across several fields
     * rather than a reading. If the unit is not what the spec says, the
     * arithmetic yields a confident wrong number rather than an obvious failure.
     *
     * Dropped, not clamped. A clamp would hide the mistake by squashing it to
     * the nearest plausible value and we would publish it as though measured;
     * a gap is visible and prompts someone to look.
     */
    mockByPath({
      "/nightly-recharge-results": {
        nightlyRechargeResults: [
          { sleepResultDate: "2026-08-17", meanNightlyRecoveryRespirationInterval: 800 },
        ],
      },
    });
    const metrics = await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(metrics.some((m) => m.metric === "respiratory_rate")).toBe(false);
  });

  it("publishes no resting heart rate, on purpose", async () => {
    /*
     * They give a mean beat-to-beat interval over a four-hour window, and
     * 60000/1100 would be a tidy 54.5 bpm. Our own screen defines resting heart
     * rate to the member as "your lowest sustained heart rate while asleep". A
     * four-hour mean is a different quantity, and a member wearing a Polar and
     * an Oura would watch the number step by several bpm whenever the merge
     * changed source, with no way to tell a rule from a bug.
     */
    mockByPath({ "/nightly-recharge-results": rechargeFixture });
    const metrics = await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(metrics.some((m) => m.metric === "resting_heart_rate")).toBe(false);
  });

  it("publishes no readiness score, on purpose", async () => {
    /*
     * `recoveryIndicator` is 1-6 and `recoveryIndicatorSubLevel` places you
     * inside that class, so a continuous value is recoverable. What is not
     * recoverable is the top of the scale: whether class 6 runs up to a notional
     * 7 or terminates decides whether to divide by five or six, and Polar do not
     * say. That is a formula we would invent and then show people as a score.
     */
    mockByPath({ "/nightly-recharge-results": rechargeFixture });
    const metrics = await polar.fetchRange!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(metrics.some((m) => m.metric === "readiness_score")).toBe(false);
  });
});

describe("steps, which Polar do not total for us", () => {
  /*
   * There is no daily step field anywhere in v4. Activity returns step SAMPLES
   * bucketed by interval, per device, and the total is ours to compute.
   */

  it("sums the sample buckets", () => {
    expect(
      polarSteps({
        date: "2026-08-17",
        activitiesPerDevice: [
          {
            deviceReference: { deviceId: "A1" },
            activitySamples: [
              { stepSamples: { startTime: "00:00:00", interval: 60000, steps: [10, 20, 30] } },
              { stepSamples: { startTime: "12:00:00", interval: 60000, steps: [40] } },
            ],
          },
        ],
      }),
    ).toBe(100);
  });

  it("takes the highest device rather than adding devices together", () => {
    /*
     * A member with a watch and a second Polar device has two things that
     * counted the same walk. Adding them reports a day this person did not have,
     * and reports it as a bigger number, which is the direction nobody
     * questions. The maximum can undercount a day split across two devices, and
     * undercounting a real day is the smaller lie.
     */
    expect(
      polarSteps({
        activitiesPerDevice: [
          { activitySamples: [{ stepSamples: { steps: [4000] } }] },
          { activitySamples: [{ stepSamples: { steps: [6000] } }] },
        ],
      }),
    ).toBe(6000);
  });

  it("returns undefined when no device reported any samples", () => {
    // Distinct from zero: a day with no data must not be published as a day
    // this member did not move.
    expect(polarSteps({ date: "2026-08-17" })).toBeUndefined();
    expect(polarSteps({ activitiesPerDevice: [{ activitySamples: [] }] })).toBeUndefined();
  });

  it("still reports a genuine zero-step device", () => {
    expect(polarSteps({ activitiesPerDevice: [{ activitySamples: [{ stepSamples: { steps: [0] } }] }] })).toBe(0);
  });
});

describe("workouts", () => {
  const sessionFixture = {
    trainingSessions: [
      {
        identifier: "1937529874",
        startTime: "2026-08-17T06:40:02.000",
        stopTime: "2026-08-17T07:25:02.000",
        durationMillis: 2_700_000,
        distanceMeters: 9840,
        calories: 500,
        hrAvg: 160,
        hrMax: 180,
        trainingLoad: 350,
        startTrigger: "TRAINING_START_MANUAL",
        timezoneOffsetMinutes: 180,
      },
    ],
  };

  it("maps the session onto our shape", async () => {
    mockByPath({ "/training-sessions/list": sessionFixture });
    const [w] = await polar.fetchWorkouts!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(w.externalId).toBe("1937529874");
    expect(w.distanceM).toBe(9840);
    // Their own field says kilocalories, which is our unit already: no
    // conversion, unlike WHOOP's kilojoules.
    expect(w.calories).toBe(500);
    expect(w.avgHeartRate).toBe(160);
    expect(w.maxHeartRate).toBe(180);
    expect(w.source).toBe("polar");
  });

  it("files the session by its local date without re-parsing the clock", async () => {
    /*
     * `startTime` is already in the member's local time and carries no zone
     * designator. Treating it as UTC and converting would move a 06:40 session
     * to the previous day for anybody east of Greenwich.
     */
    mockByPath({ "/training-sessions/list": sessionFixture });
    const [w] = await polar.fetchWorkouts!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(w.date).toBe("2026-08-17");
  });

  it("marks a session the watch started by itself", async () => {
    mockByPath({
      "/training-sessions/list": {
        trainingSessions: [
          {
            ...sessionFixture.trainingSessions[0],
            startTrigger: "TRAINING_START_AUTOMATIC_TRAINING_DETECTION",
          },
        ],
      },
    });
    const [w] = await polar.fetchWorkouts!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(w.autoDetected).toBe(true);
  });

  it("leaves autoDetected false when they do not say", async () => {
    // "They did not say", not "we know they did not".
    mockByPath({
      "/training-sessions/list": {
        trainingSessions: [{ identifier: "1", startTime: "2026-08-17T06:40:02.000" }],
      },
    });
    const [w] = await polar.fetchWorkouts!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(w.autoDetected).toBe(false);
  });

  it("carries no activity name, because their sport field is an id", async () => {
    // Resolving it needs the sports:read scope and a catalogue fetch. Worth
    // doing, not worth guessing: a wrong sport label reads to the member as
    // what their watch recorded.
    mockByPath({ "/training-sessions/list": sessionFixture });
    const [w] = await polar.fetchWorkouts!({
      accessToken: "tok",
      externalUserId: null,
      start: "2026-08-17",
      end: "2026-08-17",
    });
    expect(w.activity).toBeUndefined();
  });

  it("drops a session with no id or no start", async () => {
    mockByPath({
      "/training-sessions/list": {
        trainingSessions: [{ startTime: "2026-08-17T06:40:02.000" }, { identifier: "2" }, null],
      },
    });
    expect(
      await polar.fetchWorkouts!({
        accessToken: "tok",
        externalUserId: null,
        start: "2026-08-17",
        end: "2026-08-17",
      }),
    ).toEqual([]);
  });
});

describe("Polar count requests up, and everyone else counts down", () => {
  /*
   * Polar send `RateLimit-Usage`: requests SPENT. Every other vendor here sends
   * requests LEFT. Reading one as the other is not a small error, it is the
   * exact inverse, and both directions of that mistake look like the vendor
   * misbehaving rather than like us misreading a header.
   */

  it("converts usage into remaining", () => {
    const s = parseRateLimit(
      new Headers({
        "RateLimit-Limit": "3000",
        "RateLimit-Usage": "2900",
        "RateLimit-Reset": "300",
      }),
    );
    expect(s.limit).toBe(3000);
    expect(s.remaining).toBe(100);
    expect(s.resetSeconds).toBe(300);
  });

  it("does not read a nearly-spent budget as a nearly-full one", () => {
    // The bug this exists to prevent: 2900 landing in `remaining` unconverted,
    // so a budget with 100 calls left looks like one with 2900.
    const s = parseRateLimit(
      new Headers({ "RateLimit-Limit": "3000", "RateLimit-Usage": "2900" }),
    );
    expect(s.remaining).not.toBe(2900);
  });

  it("still reads the x-prefixed headers every other vendor sends", () => {
    const s = parseRateLimit(
      new Headers({
        "x-ratelimit-limit": "100",
        "x-ratelimit-remaining": "42",
        "x-ratelimit-reset": "60",
      }),
    );
    expect(s).toMatchObject({ limit: 100, remaining: 42, resetSeconds: 60 });
  });

  it("declines to guess when usage arrives without a limit", () => {
    // "Spent 40" means nothing without "out of what", and a guess is worse than
    // not knowing: every rule downstream treats null as "do not slow down".
    const s = parseRateLimit(new Headers({ "RateLimit-Usage": "40" }));
    expect(s.remaining).toBeNull();
  });
});
