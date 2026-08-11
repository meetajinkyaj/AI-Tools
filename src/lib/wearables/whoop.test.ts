import { describe, expect, it, vi, afterEach } from "vitest";

import { PROVIDERS } from "./providers";

/**
 * Whoop adapter, checked against their published v2 documentation.
 *
 * Written after the Ultrahuman adapter turned out to be wrong in almost every
 * particular, having been built from assumption rather than docs. This one was
 * written the same way at the same time, and was wrong in one way that mattered
 * more than the rest: `stage_summary` sits INSIDE `score`, and the old code
 * read it as a sibling. `sleep_minutes` was therefore never emitted, silently,
 * with nothing logged and nothing failing.
 *
 * The fixtures below are Whoop's own documented examples, not invented.
 */

/** developer.whoop.com, Data Types, Sleep. */
const sleepRecord = {
  id: "ecfc6a15-4661-442f-a9a4-f160dd7afae8",
  cycle_id: 93845,
  v1_id: 93845,
  user_id: 10129,
  created_at: "2022-04-24T11:25:44.774Z",
  start: "2022-04-24T02:25:44.774Z",
  end: "2022-04-24T10:25:44.774Z",
  timezone_offset: "-05:00",
  nap: false,
  score_state: "SCORED",
  score: {
    stage_summary: {
      total_in_bed_time_milli: 30_272_735,
      total_awake_time_milli: 1_403_507,
      total_no_data_time_milli: 0,
      total_light_sleep_time_milli: 14_905_851,
      total_slow_wave_sleep_time_milli: 6_630_370,
      total_rem_sleep_time_milli: 5_879_573,
      sleep_cycle_count: 3,
      disturbance_count: 12,
    },
    sleep_needed: { baseline_milli: 27_395_716 },
    respiratory_rate: 16.11328125,
    sleep_performance_percentage: 98,
    sleep_consistency_percentage: 90,
    sleep_efficiency_percentage: 91.69533848,
  },
};

/** developer.whoop.com, Data Types, Recovery. */
const recoveryRecord = {
  cycle_id: 93845,
  sleep_id: "123e4567-e89b-12d3-a456-426614174000",
  user_id: 10129,
  created_at: "2022-04-24T11:25:44.774Z",
  score_state: "SCORED",
  score: {
    user_calibrating: false,
    recovery_score: 44,
    resting_heart_rate: 64,
    hrv_rmssd_milli: 31.813562,
    spo2_percentage: 95.6875,
    skin_temp_celsius: 33.7,
  },
};

const whoop = PROVIDERS.whoop;

/** Routes by path, since one sync calls both collections. */
function mock(sleeps: unknown[], recoveries: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      new Response(
        JSON.stringify({
          records: String(url).includes("/activity/sleep") ? sleeps : recoveries,
        }),
        { status: 200 },
      ),
    ),
  );
}

const range = { accessToken: "t", externalUserId: null, start: "2022-04-24", end: "2022-04-24" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what we ask Whoop for", () => {
  it("asks for offline, without which every connection dies within the hour", () => {
    expect(whoop.scopes).toContain("offline");
    expect(whoop.refreshRotates).toBe(true);
  });

  it("does not ask for the member's name and email", () => {
    // `read:profile` returns exactly that, and we call no profile endpoint.
    // Whoop's own guidance is to request only what the app uses.
    expect(whoop.scopes).not.toContain("read:profile");
  });

  it("uses only scope strings Whoop actually publishes", () => {
    const real = [
      "offline",
      "read:cycles",
      "read:sleep",
      "read:recovery",
      "read:workout",
      "read:body_measurement",
      "read:profile",
    ];
    for (const s of whoop.scopes) expect(real, s).toContain(s);
  });

  it("calls v2, not the superseded v1", async () => {
    const spy = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response(JSON.stringify({ records: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);
    await whoop.fetchRange!(range);
    const urls = spy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(urls).toContain("/developer/v2/");
    expect(urls).not.toContain("/developer/v1/");
  });
});

describe("reading their documented sleep record", () => {
  it("finds stage_summary inside score, where it actually lives", async () => {
    // The bug this file exists for. Read as a sibling of `score`, this is
    // undefined and no sleep is ever emitted.
    mock([sleepRecord], []);
    const out = await whoop.fetchRange!(range);
    expect(out.some((m) => m.metric === "sleep_minutes")).toBe(true);
  });

  it("sums the sleep stages rather than subtracting awake from in-bed", async () => {
    mock([sleepRecord], []);
    const out = await whoop.fetchRange!(range);
    // light 14,905,851 + deep 6,630,370 + rem 5,879,573 = 27,415,794 ms = 457 min.
    expect(out.find((m) => m.metric === "sleep_minutes")).toMatchObject({ value: 457 });
  });

  it("does not count sensor gaps as sleep", async () => {
    // in_bed minus awake would include `total_no_data_time_milli`, which is
    // time the sensor knew nothing about. Here that is a full hour.
    const gappy = {
      ...sleepRecord,
      score: {
        ...sleepRecord.score,
        stage_summary: {
          ...sleepRecord.score.stage_summary,
          total_no_data_time_milli: 3_600_000,
          total_in_bed_time_milli: 30_272_735 + 3_600_000,
        },
      },
    };
    mock([gappy], []);
    const out = await whoop.fetchRange!(range);
    expect(out.find((m) => m.metric === "sleep_minutes")).toMatchObject({ value: 457 });
  });

  it("ignores naps, which would otherwise overwrite the night", async () => {
    // Naps are separate records on the same date. The metrics upsert is keyed
    // on (user, provider, date, metric), so a 20-minute nap arriving after the
    // night would replace it outright.
    const nap = {
      ...sleepRecord,
      nap: true,
      score: {
        ...sleepRecord.score,
        stage_summary: {
          total_light_sleep_time_milli: 1_200_000,
          total_slow_wave_sleep_time_milli: 0,
          total_rem_sleep_time_milli: 0,
        },
      },
    };
    mock([sleepRecord, nap], []);
    const out = await whoop.fetchRange!(range);
    const sleeps = out.filter((m) => m.metric === "sleep_minutes");
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0].value).toBe(457);
  });

  it("skips a record that has not been scored yet", async () => {
    mock([{ ...sleepRecord, score_state: "PENDING_SCORE" }], []);
    const out = await whoop.fetchRange!(range);
    expect(out).toEqual([]);
  });

  it("reads the sleep score and respiratory rate", async () => {
    mock([sleepRecord], []);
    const out = await whoop.fetchRange!(range);
    const by = Object.fromEntries(out.map((m) => [m.metric, m.value]));
    expect(by.sleep_score).toBe(98);
    expect(by.respiratory_rate).toBeCloseTo(16.11, 1);
  });

  it("keys a night to the morning it ended", async () => {
    mock([sleepRecord], []);
    const out = await whoop.fetchRange!(range);
    // Started 02:25 and ended 10:25 on the 24th, so the 24th either way; the
    // point is that `end` is what we read, matching every other adapter.
    for (const m of out) expect(m.date).toBe("2022-04-24");
  });
});

describe("reading their documented recovery record", () => {
  it("maps recovery onto readiness, and reads the physiology", async () => {
    mock([], [recoveryRecord]);
    const out = await whoop.fetchRange!(range);
    const by = Object.fromEntries(out.map((m) => [m.metric, m.value]));
    expect(by).toMatchObject({
      readiness_score: 44,
      resting_heart_rate: 64,
      spo2: 95.6875,
    });
    expect(by.hrv).toBeCloseTo(31.81, 1);
  });

  it("does not chart an absolute skin temperature as a deviation", async () => {
    // `skin_temp_celsius` is ~33. `temperature_deviation` is ~-0.2. Charting
    // one as the other is not a rounding error, it is a different quantity.
    mock([], [recoveryRecord]);
    const out = await whoop.fetchRange!(range);
    expect(out.some((m) => m.metric === "temperature_deviation")).toBe(false);
  });

  it("withholds the recovery score while the member is still calibrating", async () => {
    // Whoop flags this themselves for a new member's first weeks. The raw
    // measurements are real and are kept; only the composite is dropped.
    mock([], [{ ...recoveryRecord, score: { ...recoveryRecord.score, user_calibrating: true } }]);
    const out = await whoop.fetchRange!(range);
    expect(out.some((m) => m.metric === "readiness_score")).toBe(false);
    expect(out.some((m) => m.metric === "resting_heart_rate")).toBe(true);
  });
});

describe("Whoop workouts", () => {
  /** Their documented workout example. */
  const workout = {
    id: "ecfc6a15-4661-442f-a9a4-f160dd7afae8",
    v1_id: 1043,
    start: "2022-04-24T02:25:44.774Z",
    end: "2022-04-24T10:25:44.774Z",
    sport_name: "running",
    score_state: "SCORED",
    score: {
      strain: 8.2463,
      average_heart_rate: 123,
      max_heart_rate: 146,
      kilojoule: 1569.34033203125,
      distance_meter: 1772.77035916,
    },
    sport_id: 1,
  };

  it("CONVERTS KILOJOULES TO KCAL", async () => {
    // Their energy field is kilojoules. Storing it in a kcal column would
    // overstate every session by 4.184 and look merely like a keen athlete.
    mock([], []);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ records: [workout] }), { status: 200 })),
    );
    const out = await whoop.fetchWorkouts!(range);
    // 1569.34 kJ / 4.184 = 375 kcal.
    expect(out[0].calories).toBe(375);
  });

  it("uses sport_name, since sport_id is retired", async () => {
    // Their docs: sport_id "will not exist past 09/01/2025".
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ records: [workout] }), { status: 200 })),
    );
    const out = await whoop.fetchWorkouts!(range);
    expect(out[0].activity).toBe("running");
  });

  it("keys a session to the day it started", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ records: [workout] }), { status: 200 })),
    );
    const out = await whoop.fetchWorkouts!(range);
    expect(out[0].date).toBe("2022-04-24");
    expect(out[0].externalId).toBe(workout.id);
  });

  it("keeps an unscored session but withholds its numbers", async () => {
    // The session happened either way; only the measurements are missing.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ records: [{ ...workout, score_state: "UNSCORABLE" }] }),
          { status: 200 },
        ),
      ),
    );
    const out = await whoop.fetchWorkouts!(range);
    expect(out).toHaveLength(1);
    expect(out[0].strain).toBeUndefined();
    expect(out[0].calories).toBeUndefined();
  });

  it("requests read:workout, without which none of this arrives", () => {
    expect(whoop.scopes).toContain("read:workout");
  });
});

describe("paging through a window", () => {
  /**
   * A page holds 25 records and the rest are behind `next_token`. The adapter
   * read the first page only until the first-connect backfill was added, which
   * was correct for a 7-day window and quietly lost most of a 60-day one: the
   * member saw a fortnight of recovery and no explanation for the gap.
   */
  it("follows next_token to the end of the collection", async () => {
    const pages = [
      { records: [{ ...recoveryRecord, created_at: "2022-04-24T11:00:00.000Z" }], next_token: "p2" },
      { records: [{ ...recoveryRecord, created_at: "2022-04-23T11:00:00.000Z" }], next_token: "p3" },
      { records: [{ ...recoveryRecord, created_at: "2022-04-22T11:00:00.000Z" }] },
    ];
    let call = 0;
    const spy = vi.fn(async (url: string) => {
      // Sleep and workouts are empty here; only recovery pages.
      if (!String(url).includes("/recovery")) {
        return new Response(JSON.stringify({ records: [] }), { status: 200 });
      }
      const page = pages[Math.min(call, pages.length - 1)];
      call += 1;
      return new Response(JSON.stringify(page), { status: 200 });
    });
    vi.stubGlobal("fetch", spy);

    const out = await whoop.fetchRange!(range);
    const days = out.filter((m) => m.metric === "hrv").map((m) => m.date);
    expect(days).toEqual(["2022-04-24", "2022-04-23", "2022-04-22"]);

    // The token goes back as `nextToken`, which is spelled differently from the
    // `next_token` it arrives as. Sending the wrong one is ignored silently and
    // re-fetches page one forever.
    const urls = spy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/recovery"));
    expect(urls[1]).toContain("nextToken=p2");
    expect(urls[2]).toContain("nextToken=p3");
  });

  it("stops when a vendor hands back the same token twice", async () => {
    // Otherwise the loop spends the whole request budget on one page and takes
    // the Worker down with it.
    const spy = vi.fn(async (url: string) =>
      String(url).includes("/recovery")
        ? new Response(JSON.stringify({ records: [recoveryRecord], next_token: "same" }), {
            status: 200,
          })
        : new Response(JSON.stringify({ records: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);

    await whoop.fetchRange!(range);
    const recoveryCalls = spy.mock.calls.filter((c) => String(c[0]).includes("/recovery"));
    expect(recoveryCalls).toHaveLength(2);
  });

  it("caps how far it will walk even when the tokens keep changing", async () => {
    let n = 0;
    const spy = vi.fn(async (url: string) => {
      if (!String(url).includes("/recovery")) {
        return new Response(JSON.stringify({ records: [] }), { status: 200 });
      }
      n += 1;
      return new Response(JSON.stringify({ records: [], next_token: `t${n}` }), { status: 200 });
    });
    vi.stubGlobal("fetch", spy);

    await whoop.fetchRange!(range);
    expect(n).toBeLessThanOrEqual(12);
  });

  it("asks for a wider window on a first connect than on a nightly sync", () => {
    // The whole point of the backfill: a member's own history is on the screen
    // they land on, rather than arriving a day at a time over two weeks.
    expect(whoop.backfillWindowDays).toBeGreaterThan(whoop.syncWindowDays);
    expect(whoop.backfillWindowDays).toBeGreaterThanOrEqual(30);
  });
});

describe("awkward responses", () => {
  it("returns nothing for empty collections rather than throwing", async () => {
    mock([], []);
    expect(await whoop.fetchRange!(range)).toEqual([]);
  });

  it("ignores records whose shape it does not recognise", async () => {
    mock([{ end: "2022-04-24T10:25:44.774Z" }, null], [{}]);
    expect(await whoop.fetchRange!(range)).toEqual([]);
  });
});
