import { describe, expect, it, vi, afterEach } from "vitest";

import { PROVIDERS } from "./providers";

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
  it("drops the three scopes nothing ever read", () => {
    // profile, weight and oxygen_saturation each appeared on the consent
    // screen asking for access we never exercised.
    for (const dead of ["profile", "weight", "oxygen_saturation"]) {
      expect(fitbit.scopes, dead).not.toContain(dead);
    }
  });

  it("keeps the three it does use", () => {
    expect(fitbit.scopes).toEqual(["activity", "heartrate", "sleep"]);
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
