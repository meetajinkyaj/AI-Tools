import { describe, expect, it, vi, afterEach } from "vitest";

import { fitbitDistanceMetres, fitbitVo2Max, PROVIDERS } from "./providers";

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

/* ---------------------------------------------------------------- Fitbit ---- */

const fitbit = PROVIDERS.fitbit;

/** From Fitbit's documented sleep log shape. */
const night = {
  dateOfSleep: "2026-08-01",
  minutesAsleep: 397,
  efficiency: 68,
  isMainSleep: true,
};
const nap = {
  dateOfSleep: "2026-08-01",
  minutesAsleep: 40,
  efficiency: 96,
  isMainSleep: false,
};

describe("Fitbit scopes", () => {
  it("still asks for nothing that goes unread", () => {
    // `profile` and `weight` were dropped as dead and stay dropped.
    // `oxygen_saturation` came back only when the adapter started calling the
    // SpO2 collection, which is the right order: the scope list follows the
    // code, never the other way round.
    for (const dead of ["profile", "weight"]) {
      expect(fitbit.scopes, dead).not.toContain(dead);
    }
  });

  it("sends client credentials as Basic, which Fitbit requires", () => {
    expect(fitbit.tokenAuth).toBe("basic");
  });
});

describe("Fitbit sleep", () => {
  it("ignores naps, which would otherwise replace the night", async () => {
    // Both records carry the same `dateOfSleep`, and the upsert is keyed on
    // (user, provider, date, metric), so the nap would win on arrival order.
    route({ "/sleep/date/": { sleep: [night, nap] } });
    const out = await fitbit.fetchRange!(range);
    const sleeps = out.filter((m) => m.metric === "sleep_minutes");
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0].value).toBe(397);
  });

  it("publishes no sleep score, because efficiency is not one", async () => {
    // Fitbit's real Sleep Score is not on the public API. `efficiency` is time
    // asleep over time in bed: a different quantity, not reconcilable against
    // Fitbit's own app, and misleading beside Oura's score in one series.
    route({ "/sleep/date/": { sleep: [night] } });
    const out = await fitbit.fetchRange!(range);
    expect(out.some((m) => m.metric === "sleep_score")).toBe(false);
  });

  it("still reads steps and resting heart rate", async () => {
    route({
      "/activities/steps/": { "activities-steps": [{ dateTime: "2026-08-01", value: "9432" }] },
      "/activities/heart/": {
        "activities-heart": [{ dateTime: "2026-08-01", value: { restingHeartRate: 58 } }],
      },
    });
    const out = await fitbit.fetchRange!(range);
    const by = Object.fromEntries(out.map((m) => [m.metric, m.value]));
    // Fitbit sends step counts as STRINGS. `num` parses them.
    expect(by).toMatchObject({ steps: 9432, resting_heart_rate: 58 });
  });

  it("survives a null record instead of throwing", async () => {
    route({ "/sleep/date/": { sleep: [null, night] } });
    const out = await fitbit.fetchRange!(range);
    expect(out.some((m) => m.metric === "sleep_minutes")).toBe(true);
  });
});

describe("Fitbit VO2 max, which is a string and sometimes a range", () => {
  /**
   * Their documented example returns both forms. Fitbit gives a single number
   * only when the user runs with GPS; otherwise it is a band. `Number("44-48")`
   * is NaN, so the usual numeric helper would drop every ranged reading and the
   * metric would look like it simply never arrives for anyone who does not run.
   */
  it("takes the midpoint of a band", () => {
    expect(fitbitVo2Max("44-48")).toBe(46);
  });

  it("reads a plain value unchanged", () => {
    expect(fitbitVo2Max("45")).toBe(45);
  });

  it("keeps the series continuous across both forms", () => {
    // A user who starts running with GPS switches from bands to numbers. Both
    // have to land on the same scale or the chart steps for no reason.
    expect(fitbitVo2Max("44-48")).toBeGreaterThan(fitbitVo2Max("43")!);
    expect(fitbitVo2Max("44-48")).toBeLessThan(fitbitVo2Max("49")!);
  });

  it("gives up rather than inventing a number", () => {
    for (const junk of [undefined, "", "n/a", "-", "44-"]) {
      expect(fitbitVo2Max(junk as string | undefined), String(junk)).toBeUndefined();
    }
  });
});

describe("Fitbit's overnight collections", () => {
  it("reads HRV, SpO2, breathing rate and skin temperature", async () => {
    route({
      "/hrv/date/": { hrv: [{ dateTime: "2026-08-01", value: { dailyRmssd: 62.9, deepRmssd: 58.2 } }] },
      "/spo2/date/": { spo2: [{ dateTime: "2026-08-01", value: { avg: 95.8 } }] },
      "/br/date/": { br: [{ dateTime: "2026-08-01", value: { breathingRate: 15.4 } }] },
      "/temp/skin/date/": { tempSkin: [{ dateTime: "2026-08-01", value: { nightlyRelative: -0.2 } }] },
      "/cardioscore/date/": { cardioScore: [{ dateTime: "2026-08-01", value: { vo2Max: "44-48" } }] },
    });
    const out = await fitbit.fetchRange!(range);
    const by = Object.fromEntries(out.map((m) => [m.metric, m.value]));
    expect(by).toMatchObject({
      hrv: 62.9,
      spo2: 95.8,
      respiratory_rate: 15.4,
      temperature_deviation: -0.2,
      vo2max: 46,
    });
  });

  it("uses the whole-night HRV, not the deep-sleep one", async () => {
    // `deepRmssd` covers deep sleep only and is not what other vendors report.
    route({
      "/hrv/date/": { hrv: [{ dateTime: "2026-08-01", value: { dailyRmssd: 62.9, deepRmssd: 58.2 } }] },
    });
    const out = await fitbit.fetchRange!(range);
    expect(out.find((m) => m.metric === "hrv")?.value).toBe(62.9);
  });

  it("keeps a negative temperature deviation negative", async () => {
    // nightlyRelative is already a deviation from baseline, unlike Whoop's
    // absolute skin_temp_celsius. Clamping would erase the signal.
    route({
      "/temp/skin/date/": { tempSkin: [{ dateTime: "2026-08-01", value: { nightlyRelative: -0.4 } }] },
    });
    const out = await fitbit.fetchRange!(range);
    expect(out.find((m) => m.metric === "temperature_deviation")?.value).toBe(-0.4);
  });

  it("survives a declined scope without failing the whole sync", async () => {
    // A member can untick any of these at the consent screen. Losing steps and
    // sleep over a metric they chose not to share would be the wrong trade, and
    // a 403 reaches the sweep as ReauthRequired, which marks the connection
    // dead outright.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/hrv/") || u.includes("/temp/") || u.includes("/cardioscore/")) {
          return new Response("", { status: 403 });
        }
        if (u.includes("/activities/steps/")) {
          return new Response(
            JSON.stringify({ "activities-steps": [{ dateTime: "2026-08-01", value: "9000" }] }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const out = await fitbit.fetchRange!(range);
    expect(out.find((m) => m.metric === "steps")?.value).toBe(9000);
    expect(out.some((m) => m.metric === "hrv")).toBe(false);
  });

  it("asks for every scope it reads, and nothing more", () => {
    expect(fitbit.scopes).toEqual([
      "activity",
      "heartrate",
      "sleep",
      "oxygen_saturation",
      "cardio_fitness",
      "respiratory_rate",
      "temperature",
    ]);
    // Still dead, still absent.
    expect(fitbit.scopes).not.toContain("weight");
    expect(fitbit.scopes).not.toContain("profile");
  });
});

describe("Fitbit distance, which is not reliably metric", () => {
  it("converts using the unit Fitbit sent, not an assumption", () => {
    // Their data dictionary: distance comes back in "units defined by the
    // Accept-Language header", and their own examples show Mile. Reading it as
    // kilometres understates an American member's run by 38%, silently.
    expect(fitbitDistanceMetres(1.872894, "Mile")).toBe(3014);
    expect(fitbitDistanceMetres(5, "Kilometer")).toBe(5000);
    expect(fitbitDistanceMetres(400, "Meter")).toBe(400);
  });

  it("returns nothing rather than guessing at an unknown unit", () => {
    // A missing distance is a blank field. A wrong one is a lie in a health
    // record, and nothing downstream could tell the difference.
    expect(fitbitDistanceMetres(5, undefined)).toBeUndefined();
    expect(fitbitDistanceMetres(5, "furlong")).toBeUndefined();
    expect(fitbitDistanceMetres(undefined, "Mile")).toBeUndefined();
  });
});

describe("Fitbit workouts", () => {
  const fitbit = PROVIDERS.fitbit;

  const activity = (over: Record<string, unknown> = {}) => ({
    logId: 19018673358,
    activityName: "Run",
    startTime: "2026-08-01T07:08:29.000-08:00",
    duration: 1_800_000, // 30 minutes, including pauses
    activeDuration: 1_700_000,
    calories: 340,
    distance: 5,
    distanceUnit: "Kilometer",
    averageHeartRate: 148,
    logType: "tracker",
    source: { name: "Fitbit for Android" },
    ...over,
  });

  it("reads a session, deriving the end from the duration", () => {
    // Fitbit gives no end time. `duration` includes pauses, which is the right
    // one for a start-to-end pair: Oura's and Whoop's spans include theirs too.
    route({ "/activities/list.json": { activities: [activity()] } });
    return fitbit.fetchWorkouts!(range).then((out) => {
      expect(out).toHaveLength(1);
      expect(out[0].externalId).toBe("19018673358");
      expect(out[0].activity).toBe("Run");
      expect(out[0].distanceM).toBe(5000);
      expect(out[0].avgHeartRate).toBe(148);
      expect(out[0].source).toBe("Fitbit for Android");
      expect(Date.parse(out[0].endedAt) - Date.parse(out[0].startedAt)).toBe(1_800_000);
    });
  });

  it("keeps the member's own local day, not a UTC one", async () => {
    // 07:08 at -08:00 is 15:08 UTC on the same day, but an evening session
    // would cross midnight and land on the wrong date if converted first.
    route({
      "/activities/list.json": {
        activities: [activity({ startTime: "2026-08-01T22:40:00.000+05:30" })],
      },
    });
    const out = await fitbit.fetchWorkouts!(range);
    expect(out[0].date).toBe("2026-08-01");
  });

  it("keeps an auto-detected walk, and labels it as one", async () => {
    // SmartTrack logs a "Walk" after about fifteen minutes, unasked. An
    // earlier version threw these away so they could not inflate the training
    // count; that protected the number by losing real data. A walk is
    // movement, movement counts for health, so it is stored and marked.
    route({
      "/activities/list.json": {
        activities: [
          activity({ logId: 1, activityName: "Walk", logType: "auto_detected", duration: 900_000 }),
        ],
      },
    });
    const out = await fitbit.fetchWorkouts!(range);
    expect(out).toHaveLength(1);
    expect(out[0].autoDetected).toBe(true);
  });

  it("marks anything the member started as not auto-detected", async () => {
    // Intent is the line, not duration: starting one says you meant it. Length
    // never enters into it, so a ten minute deliberate session still counts.
    for (const logType of ["tracker", "manual", "mobile_run", "fitstar"]) {
      route({
        "/activities/list.json": {
          activities: [activity({ logId: 3, logType, duration: 600_000 })],
        },
      });
      const out = await fitbit.fetchWorkouts!(range);
      expect(out, logType).toHaveLength(1);
      expect(out[0].autoDetected, logType).toBe(false);
    }
  });

  it("trims the far edge of the window itself", async () => {
    // The endpoint takes afterDate and no end date, so anything past `end`
    // comes back and has to be dropped here.
    route({
      "/activities/list.json": {
        activities: [
          activity({ logId: 4, startTime: "2026-08-09T07:00:00.000-08:00" }),
          activity({ logId: 5 }),
        ],
      },
    });
    const out = await fitbit.fetchWorkouts!(range);
    expect(out.map((w) => w.externalId)).toEqual(["5"]);
  });

  it("survives a null entry and a missing id instead of throwing", async () => {
    route({
      "/activities/list.json": {
        activities: [null, { activityName: "Run" }, activity({ duration: 0 }), activity({ logId: 9 })],
      },
    });
    const out = await fitbit.fetchWorkouts!(range);
    expect(out.map((w) => w.externalId)).toEqual(["9"]);
  });

  it("leaves distance out when Fitbit did not say the unit", async () => {
    route({
      "/activities/list.json": {
        activities: [activity({ distanceUnit: undefined })],
      },
    });
    const out = await fitbit.fetchWorkouts!(range);
    expect(out[0].distanceM).toBeUndefined();
  });
});
