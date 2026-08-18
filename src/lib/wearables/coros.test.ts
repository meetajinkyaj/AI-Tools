import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROVIDERS, corosLocalDay, corosWindows } from "./providers";
import { clearRateLimits } from "./rate-limit";
import { extendToken, requestTokens } from "./sync";
import { ReauthRequired } from "./types";

/**
 * COROS, checked against their own API Reference V2.0.6.
 *
 * WHY THESE FIXTURES ARE COPIED RATHER THAN INVENTED. Four things about this
 * vendor are unlike the other six, and every one of them is the kind of
 * difference that produces a working-looking integration that quietly stores
 * nothing: the token travels as a query parameter, a refresh returns no
 * credentials, success lives in the body rather than the status code, and a
 * query may not span more than thirty days. The payloads below are lifted
 * verbatim from sections 3.2, 3.3, 4.2.4 and 4.3.4 of their guide, so that when
 * this adapter meets a real COROS account for the first time, what it meets is
 * not a surprise.
 *
 * NOTHING HERE HAS RUN AGAINST A LIVE ACCOUNT. Access is still awaiting COROS's
 * review, which is why the provider carries an `unavailable` reason. These
 * tests pin what their documentation says; they cannot pin what their servers
 * do, and the two are not the same claim.
 */

const coros = PROVIDERS.coros;

/** Section 4.3.4, their return example, unedited. */
const dailyFixture = {
  data: {
    dailyList: [
      {
        happenDay: 20200615,
        sleepStartTime: "2020-06-14 22:00:01",
        sleepEndTime: "2020-06-15 08:00:01",
        calorie: 9553,
        step: 52,
        rhr: 56,
        hrvList: [
          { hrv: 25, hr: 60, timestamp: 1592098222 },
          { hrv: 30, timestamp: 1592101822 },
        ],
        ppgHrv: 50,
        sleepAvgHr: 70,
      },
      {
        happenDay: 20200616,
        sleepStartTime: "2020-06-15 22:00:01",
        sleepEndTime: "2020-06-18 08:00:01",
        calorie: 9553,
        step: 52,
        rhr: 56,
        hrvList: [{ hrv: 21, hr: 68, timestamp: 1592247630 }],
        ppgHrv: 51,
        sleepAvgHr: 76,
      },
    ],
  },
  message: "OK",
  result: "0000",
};

/** Section 4.2.4, their return example, trimmed to the first record. */
const workoutFixture = {
  data: [
    {
      mode: 8,
      avgFrequency: 8,
      avgSpeed: 163,
      calorie: 9553,
      deviceName: "COROS PACE",
      distance: 3014,
      duration: 491,
      endTime: 1516097362,
      labelId: "406974289395351552",
      subMode: 1,
      startTime: 1516096869,
      step: 52,
      startTimezone: 32,
      endTimezone: 32,
      fitUrl: "https://oss.coros.com/fit/407419767966679040/418173292602490880.fit",
    },
  ],
  message: "OK",
  result: "0000",
};

/** Every URL the adapter asked for, in order, so the shape can be asserted. */
let calls: string[] = [];

/**
 * Answer each request with the next body in the queue, HTTP 200 throughout.
 *
 * 200 IS THE POINT. COROS return it for refusals too, so a mock that used
 * status codes to signal failure would test a vendor that does not exist.
 */
function mockSequence(bodies: unknown[]) {
  const queue = [...bodies];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      const body = queue.length > 1 ? queue.shift() : queue[0];
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

beforeEach(() => {
  calls = [];
  clearRateLimits();
  vi.stubEnv("COROS_CLIENT_ID", "test-client");
  vi.stubEnv("COROS_CLIENT_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("how COROS is addressed", () => {
  it("asks for no scopes, because their OAuth defines none", () => {
    /*
     * Not an oversight and not a stub. Their authorize request takes client_id,
     * redirect_uri, state and response_type; there is no scope vocabulary in
     * the guide at all. `connect/route.ts` omits the parameter entirely when
     * this is empty rather than sending `scope=`.
     */
    expect(coros.scopes).toEqual([]);
  });

  it("refreshes at a different URL from the one that issues tokens", () => {
    expect(coros.tokenUrl).toBe("https://open.coros.com/oauth2/accesstoken");
    expect(coros.refreshUrl).toBe("https://open.coros.com/oauth2/refresh-token");
  });

  it("declares that a refresh extends rather than reissues, and does not rotate", () => {
    // Both flags drive real branches in `accessTokenFor`. See types.ts.
    expect(coros.refreshExtendsToken).toBe(true);
    expect(coros.refreshRotates).toBe(false);
  });

  it("puts the token in the query string, not an Authorization header", async () => {
    mockSequence([dailyFixture]);
    await coros.fetchRange!({
      accessToken: "tok",
      externalUserId: "openid-1",
      start: "2020-06-15",
      end: "2020-06-16",
    });
    expect(calls[0]).toContain("token=tok");
    expect(calls[0]).toContain("openId=openid-1");
  });

  it("sends dates as yyyyMMdd, which is the only format their query accepts", async () => {
    mockSequence([dailyFixture]);
    await coros.fetchRange!({
      accessToken: "tok",
      externalUserId: "openid-1",
      start: "2020-06-15",
      end: "2020-06-16",
    });
    expect(calls[0]).toContain("startDate=20200615");
    expect(calls[0]).toContain("endDate=20200616");
  });

  it("fetches nothing at all without an openId", async () => {
    // Their endpoints identify the member by openId, not by the token, so a
    // connection missing one cannot be read. Asking anyway spends budget to
    // earn an error.
    mockSequence([dailyFixture]);
    expect(
      await coros.fetchRange!({
        accessToken: "tok",
        externalUserId: null,
        start: "2020-06-15",
        end: "2020-06-16",
      }),
    ).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("thirty days per query", () => {
  it("splits a ninety-day backfill into chunks their API will accept", () => {
    const windows = corosWindows("2026-01-01", "2026-03-31");
    expect(windows).toEqual([
      { start: "2026-01-01", end: "2026-01-30" },
      { start: "2026-01-31", end: "2026-03-01" },
      { start: "2026-03-02", end: "2026-03-31" },
    ]);
    // Contiguous and non-overlapping: a gap would lose days silently, and an
    // overlap would spend requests re-fetching what upsert then discards.
    for (let i = 1; i < windows.length; i += 1) {
      const prevEnd = Date.parse(`${windows[i - 1].end}T00:00:00Z`);
      const thisStart = Date.parse(`${windows[i].start}T00:00:00Z`);
      expect(thisStart - prevEnd).toBe(86_400_000);
    }
  });

  it("never emits a window longer than their limit", () => {
    for (const w of corosWindows("2026-01-01", "2026-03-31")) {
      const days =
        (Date.parse(`${w.end}T00:00:00Z`) - Date.parse(`${w.start}T00:00:00Z`)) / 86_400_000 + 1;
      expect(days).toBeLessThanOrEqual(30);
    }
  });

  it("returns a single window for a routine seven-day sync", () => {
    expect(corosWindows("2026-08-11", "2026-08-18")).toEqual([
      { start: "2026-08-11", end: "2026-08-18" },
    ]);
  });

  it("returns nothing for a backwards or unparseable range", () => {
    expect(corosWindows("2026-03-31", "2026-01-01")).toEqual([]);
    expect(corosWindows("not-a-date", "2026-01-01")).toEqual([]);
  });

  it("backfills the ninety days that are all they keep", () => {
    // Not a judgement about how much history is worth having: "the query date
    // is not earlier than three months before the day" is the whole of what
    // exists at their end.
    expect(coros.backfillWindowDays).toBe(90);
    expect(coros.syncWindowDays).toBe(7);
  });

  it("makes one request per window, so a backfill is four calls and not one refusal", async () => {
    mockSequence([{ data: { dailyList: [] }, result: "0000" }]);
    await coros.fetchRange!({
      accessToken: "tok",
      externalUserId: "openid-1",
      start: "2026-01-01",
      end: "2026-03-31",
    });
    expect(calls).toHaveLength(3);
  });
});

describe("daily data, from their own example", () => {
  it("maps steps, resting heart rate and overnight HRV", async () => {
    mockSequence([dailyFixture]);
    const metrics = await coros.fetchRange!({
      accessToken: "tok",
      externalUserId: "openid-1",
      start: "2020-06-15",
      end: "2020-06-16",
    });

    expect(metrics).toContainEqual({
      metric: "steps",
      date: "2020-06-15",
      value: 52,
      source: "coros",
    });
    expect(metrics).toContainEqual({
      metric: "resting_heart_rate",
      date: "2020-06-15",
      value: 56,
      source: "coros",
    });
    expect(metrics).toContainEqual({
      metric: "hrv",
      date: "2020-06-15",
      value: 50,
      source: "coros",
    });
  });

  it("reads hrv from ppgHrv and not from the intraday list", async () => {
    /*
     * `ppgHrv` is labelled "Overnight HRV", which is what our `hrv` key means.
     * The two samples in `hrvList` average to 27.5 for the same day; publishing
     * that under the same name would be a different quantity wearing our
     * vocabulary, and no chart would show the difference.
     */
    mockSequence([dailyFixture]);
    const metrics = await coros.fetchRange!({
      accessToken: "tok",
      externalUserId: "openid-1",
      start: "2020-06-15",
      end: "2020-06-16",
    });
    const hrv = metrics.filter((m) => m.metric === "hrv").map((m) => m.value);
    expect(hrv).toEqual([50, 51]);
    expect(hrv).not.toContain(27.5);
  });

  it("turns happenDay into a real date", async () => {
    mockSequence([dailyFixture]);
    const metrics = await coros.fetchRange!({
      accessToken: "tok",
      externalUserId: "openid-1",
      start: "2020-06-15",
      end: "2020-06-16",
    });
    expect([...new Set(metrics.map((m) => m.date))]).toEqual(["2020-06-15", "2020-06-16"]);
  });

  it("publishes no sleep at all, on purpose", async () => {
    /*
     * THE DECISION THIS TEST EXISTS TO PROTECT. COROS give a window,
     * `sleepStartTime` to `sleepEndTime`, with no stages. Our `sleep_minutes`
     * is defined on the member's own screen as time actually asleep, which
     * reads lower than time in bed. Filling that key from a window would make
     * the definition we show people false for COROS members and would put two
     * different quantities on one chart for anybody wearing two devices.
     *
     * Their own fixture makes the case: the second night runs from 2020-06-15
     * 22:00 to 2020-06-18 08:00, which is either a typo or fifty-eight hours,
     * and nothing in the payload distinguishes them.
     */
    mockSequence([dailyFixture]);
    const metrics = await coros.fetchRange!({
      accessToken: "tok",
      externalUserId: "openid-1",
      start: "2020-06-15",
      end: "2020-06-16",
    });
    expect(metrics.some((m) => m.metric.startsWith("sleep"))).toBe(false);
  });

  it("publishes no calories, because the unit cannot be determined", async () => {
    /*
     * Their table says "Unit: calorie" and their example pairs 9,553 of them
     * with 52 steps, which is impossible as kilocalories and absurd as
     * calories. A number nobody can check is worse than a blank.
     */
    mockSequence([dailyFixture]);
    const metrics = await coros.fetchRange!({
      accessToken: "tok",
      externalUserId: "openid-1",
      start: "2020-06-15",
      end: "2020-06-16",
    });
    expect(metrics.some((m) => m.metric.includes("calorie"))).toBe(false);
    expect(metrics.some((m) => m.value === 9553)).toBe(false);
  });

  it("skips a day with an unusable happenDay rather than inventing one", async () => {
    mockSequence([
      { result: "0000", data: { dailyList: [{ happenDay: 202006, step: 100 }, null, { step: 200 }] } },
    ]);
    expect(
      await coros.fetchRange!({
        accessToken: "tok",
        externalUserId: "openid-1",
        start: "2020-06-15",
        end: "2020-06-16",
      }),
    ).toEqual([]);
  });
});

describe("workouts, from their own example", () => {
  it("keeps labelId as the external id, which is half the idempotency key", async () => {
    mockSequence([workoutFixture]);
    const [w] = await coros.fetchWorkouts!({
      accessToken: "tok",
      externalUserId: "openid-1",
      start: "2018-01-16",
      end: "2018-01-16",
    });
    expect(w.externalId).toBe("406974289395351552");
    expect(w.startedAt).toBe(new Date(1516096869 * 1000).toISOString());
    expect(w.endedAt).toBe(new Date(1516097362 * 1000).toISOString());
    expect(w.distanceM).toBe(3014);
    expect(w.activity).toBe("Run");
    expect(w.source).toBe("coros");
  });

  it("files the session to the member's own day, not to UTC", async () => {
    /*
     * `startTimezone` counts 15-minute steps, so 32 is UTC+08:00. The fixture
     * starts at 1516096869, which is 2018-01-16 08:41 UTC and 16:41 locally:
     * the same day here, but a 06:00 session in India would land on the
     * previous day in UTC, and that is how a training week quietly loses a
     * Monday.
     */
    expect(corosLocalDay(1516096869, 32)).toBe("2018-01-16");
    // 22:30 UTC on the 16th is 06:30 on the 17th for that member.
    expect(corosLocalDay(Date.parse("2018-01-16T22:30:00Z") / 1000, 32)).toBe("2018-01-17");
    // No timezone reported means UTC, which is honest, rather than this
    // server's timezone, which has nothing to do with the member.
    expect(corosLocalDay(Date.parse("2018-01-16T22:30:00Z") / 1000)).toBe("2018-01-16");
    // Negative offsets are the same arithmetic. -32 is UTC-08:00.
    expect(corosLocalDay(Date.parse("2018-01-16T04:00:00Z") / 1000, -32)).toBe("2018-01-15");
  });

  it("carries no calories on a session either", async () => {
    mockSequence([workoutFixture]);
    const [w] = await coros.fetchWorkouts!({
      accessToken: "tok",
      externalUserId: "openid-1",
      start: "2018-01-16",
      end: "2018-01-16",
    });
    expect(w.calories).toBeUndefined();
  });

  it("leaves the activity blank for a sport code it does not know", async () => {
    // A wrong label is worse than none: the member reads it as what their watch
    // recorded.
    mockSequence([{ result: "0000", data: [{ ...workoutFixture.data[0], mode: 999 }] }]);
    const [w] = await coros.fetchWorkouts!({
      accessToken: "tok",
      externalUserId: "openid-1",
      start: "2018-01-16",
      end: "2018-01-16",
    });
    expect(w.activity).toBeUndefined();
  });

  it("drops a record with no id or no timestamps", async () => {
    mockSequence([
      {
        result: "0000",
        data: [
          { mode: 8, startTime: 1516096869, endTime: 1516097362 },
          { labelId: "1", mode: 8 },
          null,
        ],
      },
    ]);
    expect(
      await coros.fetchWorkouts!({
        accessToken: "tok",
        externalUserId: "openid-1",
        start: "2018-01-16",
        end: "2018-01-16",
      }),
    ).toEqual([]);
  });
});

describe("success lives in the body, not the status code", () => {
  it("treats a 200 carrying a non-zero result as a failure", async () => {
    /*
     * The whole hazard in one test. Their transport is 200 for a result and for
     * a refusal alike; an adapter reading only the HTTP code would store an
     * empty day, which looks exactly like a member who did not wear their
     * watch. The second body answers the binding check that the error path
     * makes, saying the member is still bound.
     */
    mockSequence([
      { result: "1001", message: "invalid token" },
      { result: "0000", data: { bindState: 1 } },
    ]);
    await expect(
      coros.fetchRange!({
        accessToken: "tok",
        externalUserId: "openid-1",
        start: "2020-06-15",
        end: "2020-06-16",
      }),
    ).rejects.toThrow(/result 1001/);
  });

  it("asks for re-consent when COROS say the watch is unbound", async () => {
    /*
     * Their guide documents "0000" and no error vocabulary whatsoever, so a
     * member who revoked us and a COROS having a bad afternoon arrive as the
     * same opaque string. Section 3.5 is the one question that separates them,
     * and only a clear zero counts.
     */
    mockSequence([
      { result: "2001", message: "unauthorized" },
      { result: "0000", data: { bindState: 0 } },
    ]);
    await expect(
      coros.fetchRange!({
        accessToken: "tok",
        externalUserId: "openid-1",
        start: "2020-06-15",
        end: "2020-06-16",
      }),
    ).rejects.toBeInstanceOf(ReauthRequired);
  });

  it("keeps the original error when the binding check itself cannot answer", async () => {
    // "We could not tell" must not read as "the grant is dead". A second
    // failing call is evidence of nothing.
    mockSequence([
      { result: "9999", message: "service busy" },
      { result: "9999", message: "service busy" },
    ]);
    const err = await coros
      .fetchRange!({
        accessToken: "tok",
        externalUserId: "openid-1",
        start: "2020-06-15",
        end: "2020-06-16",
      })
      .catch((e) => e);
    expect(err).not.toBeInstanceOf(ReauthRequired);
    expect(String(err)).toContain("9999");
  });
});

describe("the token exchange", () => {
  it("reads camelCase and snake_case, because their guide documents both", async () => {
    /*
     * Their parameter table names `accessToken`, `refreshToken` and
     * `expiresIn`; the worked example three lines below returns `access_token`,
     * `refresh_token` and `expires_in`. Reading one spelling makes a successful
     * exchange look like one that returned nothing, and the difference is
     * invisible until a real member connects.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ accessToken: "a", refreshToken: "r", expiresIn: 2592000, openId: "o" }),
            { status: 200 },
          ),
      ),
    );
    expect(await requestTokens("coros", { grant_type: "authorization_code", code: "c" })).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 2592000,
      scope: undefined,
      externalUserId: "o",
    });
  });

  it("reads their documented example verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              expires_in: 2592000,
              refresh_token: "08a06b7df38d0d2852e5xx5",
              access_token: "db0214b6006e7570bdxx",
              openId: "b93ac3b5df6b4db3bexx",
            }),
            { status: 200 },
          ),
      ),
    );
    const tokens = await requestTokens("coros", { grant_type: "authorization_code", code: "c" });
    expect(tokens.accessToken).toBe("db0214b6006e7570bdxx");
    // openId is the only thing that identifies the member on every later call.
    expect(tokens.externalUserId).toBe("b93ac3b5df6b4db3bexx");
  });

  it("repeats what the vendor said when there is no token in the answer", async () => {
    // COROS refuse a code exchange with HTTP 200 and a result code, so this is
    // where their failures land.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ result: "1002", message: "code expired" }), {
            status: 200,
          }),
      ),
    );
    await expect(
      requestTokens("coros", { grant_type: "authorization_code", code: "c" }),
    ).rejects.toThrow(/1002 code expired/);
  });
});

describe("a refresh that returns no credentials", () => {
  it("treats their acknowledgement as thirty more days", async () => {
    /*
     * `{"result":"0000","message":"OK"}` is a complete success at COROS: the
     * token already held now lives another month. Code expecting credentials
     * throws "returned no access_token" here and kills a working grant.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ result: "0000", message: "OK" }), { status: 200 }),
      ),
    );
    const before = Date.now();
    const { expiresAt } = await extendToken("coros", "refresh-token");
    const days = (Date.parse(expiresAt) - before) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("posts to the refresh URL, not the token URL", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ result: "0000" }), { status: 200 });
      }),
    );
    await extendToken("coros", "refresh-token");
    expect(seen).toEqual(["https://open.coros.com/oauth2/refresh-token"]);
  });

  it("refuses to bank thirty days on a 200 that says it failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ result: "1003", message: "bad refresh token" }), {
            status: 200,
          }),
      ),
    );
    await expect(extendToken("coros", "refresh-token")).rejects.toThrow(/result 1003/);
  });

  it("asks for re-consent when the refresh is rejected outright", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    await expect(extendToken("coros", "refresh-token")).rejects.toBeInstanceOf(ReauthRequired);
  });
});

describe("what the member is promised", () => {
  it("does not offer sleep in the blurb the adapter does not deliver", () => {
    expect(coros.blurb.toLowerCase()).not.toContain("sleep");
  });

  it("stays hidden until COROS have actually granted access", () => {
    /*
     * Credentials alone must not switch this on. The adapter is written from a
     * PDF and has never spoken to their servers; `unavailable` is what keeps a
     * future reader from concluding the integration is one registration away.
     */
    expect(coros.unavailable).toBeTruthy();
  });
});
