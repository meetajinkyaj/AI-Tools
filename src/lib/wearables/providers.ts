import "server-only";

import { providerFetch, num } from "./http";
import {
  clampScore,
  dayOf,
  secondsToMinutes,
  type DailyMetric,
  type MetricKey,
} from "./metrics";
import {
  PROVIDER_NAMES,
  ReauthRequired,
  type ProviderId,
  type WearableProvider,
  type WorkoutSession,
} from "./types";

/**
 * The six cloud wearable adapters.
 *
 * Each is roughly: where OAuth lives, what to ask for, and how to turn one
 * vendor's JSON into `DailyMetric[]`. All the machinery around them, refresh,
 * rotation, backoff, upsert, is in `sync.ts` and shared.
 *
 * NONE OF THESE WORK WITHOUT CREDENTIALS. Every vendor requires registering a
 * developer application to get a client id and secret; two of them (Garmin,
 * Ultrahuman) require an approved application on top, with a lead time of
 * weeks. A provider whose env vars are unset is simply hidden from the UI, so
 * this file being complete does not mean the feature is live, see
 * `docs/WEARABLES.md`.
 *
 * ENDPOINTS DRIFT. These are written against each vendor's documented v1/v2
 * APIs as of mid-2026. The normalizers are defensive, an unexpected shape
 * yields fewer metrics, never a crash, but if a provider suddenly returns
 * nothing, check their changelog before debugging this file.
 */

/**
 * Every date from `start` to `end` inclusive, as YYYY-MM-DD.
 *
 * Needed because Ultrahuman's OAuth metrics endpoint takes a single `date` and
 * has no range form, so a window is a loop rather than one call.
 */
function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return out;
  // Guard against a mistaken window turning into thousands of requests.
  for (let t = from, i = 0; t <= to && i < 40; t += 86_400_000, i += 1) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Ultrahuman's metrics payload.
 *
 * Modelled on their documented example rather than guessed. The awkward part
 * is that `metrics` is a date-keyed map of arrays of typed entries, and the
 * value lives under a different key depending on the entry: `value` for
 * scalars, `avg` for averaged series, `total` for steps.
 */
interface UltrahumanEntryObject {
  value?: unknown;
  avg?: unknown;
  total?: unknown;
}

interface UltrahumanMetricsResponse {
  data?: {
    metrics?: Record<string, { type?: string; object?: UltrahumanEntryObject }[]>;
  };
}

function push(
  out: DailyMetric[],
  metric: MetricKey,
  date: string | undefined,
  value: number | undefined,
  source?: string,
) {
  if (!date || value === undefined || !Number.isFinite(value)) return;
  out.push({ metric, date, value, source });
}

/* -------------------------------------------------------------------------- */
/* Oura                                                                        */
/* -------------------------------------------------------------------------- */

/** Oura's v2 workout document, from their generated schema. */
interface OuraWorkout {
  id?: string;
  activity?: string;
  calories?: number;
  day?: string;
  distance?: number;
  end_datetime?: string;
  intensity?: string;
  source?: string;
  start_datetime?: string;
}

interface OuraDoc {
  day?: string;
  score?: number;
  /** daily_stress, seconds in the top and bottom quartile zones. */
  stress_high?: number;
  recovery_high?: number;
  /** daily_cardiovascular_age, a prediction in years, range 18 to 100. */
  vascular_age?: number;
  /** vO2_max. */
  vo2_max?: number;
  total_sleep_duration?: number;
  average_hrv?: number;
  average_heart_rate?: number;
  lowest_heart_rate?: number;
  spo2_percentage?: { average?: number };
  steps?: number;
  active_calories?: number;
  bedtime_end?: string;
}

const oura: WearableProvider = {
  id: "oura",
  name: PROVIDER_NAMES.oura,
  blurb: "Sleep, readiness and HRV from your Oura ring.",
  clientIdEnv: "OURA_CLIENT_ID",
  clientSecretEnv: "OURA_CLIENT_SECRET",
  authorizeUrl: "https://cloud.ouraring.com/oauth/authorize",
  tokenUrl: "https://api.ouraring.com/oauth/token",
  // Oura publishes eight scopes: email, personal, daily, heartrate, workout,
  // tag, session, spo2. Ask for four of them and no more, since the member
  // sees this list and can toggle each one off.
  //
  // `spo2` WAS MISSING and is why blood oxygen never appeared: it gates a
  // separate `daily_spo2` collection, and the old code looked for a
  // `spo2_percentage` field on the sleep document, where no such field exists.
  //
  // `personal` was dropped. It exposes gender, age, height and weight, and we
  // call no personal endpoint at all.
  //
  // `heartrate` is kept although we never call `/heartrate` directly. Their
  // docs are not explicit about whether the HRV and resting-heart-rate fields
  // on the sleep document sit behind it, and losing those silently is much
  // worse than carrying one scope we may not need. Same reasoning as Whoop's
  // `read:cycles`.
  // `workout` was added when workout sync landed. It is on Oura's published
  // list of eight, so unlike Stress and Heart Health there is no guesswork.
  scopes: ["daily", "heartrate", "spo2", "workout"],
  tokenAuth: "body",
  refreshRotates: true,
  syncWindowDays: 7,
  async fetchRange({ accessToken, start, end }) {
    const out: DailyMetric[] = [];
    const base = "https://api.ouraring.com/v2/usercollection";
    const qs = `start_date=${start}&end_date=${end}`;

    /**
     * A collection we can live without.
     *
     * WHY THIS EXISTS. Oura's newer portal offers `Stress` and `Heart Health`
     * as separate grants, and their OAuth scope strings are not in any public
     * documentation: the published list has eight entries and contains neither.
     * The collections are real, so the likelihood is that they ride on `daily`,
     * but likelihood is not knowledge, and this project has already paid twice
     * for acting on a plausible first explanation.
     *
     * So they are requested and allowed to fail. Critically that includes 403,
     * which `providerFetch` turns into `ReauthRequired`: without this catch a
     * missing optional scope would mark the whole connection dead and ask the
     * member to reconnect, which is a far worse outcome than one absent metric.
     *
     * The moment a real member connects, the logs settle whether these arrive,
     * and the scope list can stop guessing.
     */
    const optional = async (path: string): Promise<OuraDoc[]> => {
      try {
        const res = await providerFetch<{ data?: OuraDoc[] }>(
          "oura",
          `${base}/${path}?${qs}`,
          { accessToken },
        );
        return res.data ?? [];
      } catch {
        return [];
      }
    };

    // These collections return `next_token` when truncated. A 7-day window is
    // one document per day, so it is never reached; widen `syncWindowDays` and
    // pagination has to be handled first.
    const [sleep, readiness, activity, spo2, stress, cardio, vo2] = await Promise.all([
      providerFetch<{ data?: OuraDoc[] }>("oura", `${base}/daily_sleep?${qs}`, { accessToken }),
      providerFetch<{ data?: OuraDoc[] }>("oura", `${base}/daily_readiness?${qs}`, { accessToken }),
      providerFetch<{ data?: OuraDoc[] }>("oura", `${base}/daily_activity?${qs}`, { accessToken }),
      providerFetch<{ data?: OuraDoc[] }>("oura", `${base}/daily_spo2?${qs}`, { accessToken }),
      optional("daily_stress"),
      optional("daily_cardiovascular_age"),
      optional("vO2_max"),
    ]);

    for (const d of sleep.data ?? []) push(out, "sleep_score", d.day, num(d.score), "oura");
    for (const d of readiness.data ?? []) {
      push(out, "readiness_score", d.day, num(d.score), "oura");
    }
    for (const d of activity.data ?? []) {
      push(out, "steps", d.day, num(d.steps), "oura");
      push(out, "active_calories", d.day, num(d.active_calories), "oura");
    }

    // Blood oxygen is its OWN collection, not a field on the sleep document.
    // This is the correction: `spo2_percentage` was being read off `/sleep`,
    // where it does not exist, so the metric was never emitted.
    for (const d of spo2.data ?? []) {
      push(out, "spo2", d.day, num(d.spo2_percentage?.average), "oura");
    }

    // Seconds in their payload, minutes in ours, like every other duration here.
    for (const d of stress) {
      const high = num(d.stress_high);
      if (high !== undefined) {
        push(out, "stress_high_minutes", d.day, secondsToMinutes(high), "oura");
      }
      const restored = num(d.recovery_high);
      if (restored !== undefined) {
        push(out, "recovery_high_minutes", d.day, secondsToMinutes(restored), "oura");
      }
    }

    // A prediction in years, not a measurement. The metric's own comment says
    // so, and any surface showing it has to as well.
    for (const d of cardio) push(out, "vascular_age", d.day, num(d.vascular_age), "oura");

    // `vO2_max`, capitalised exactly like that in their path. Our vocabulary
    // already had the key and no adapter was filling it.
    for (const d of vo2) push(out, "vo2max", d.day, num(d.vo2_max), "oura");

    // Detailed sleep carries the physiology; it is a separate collection.
    const detail = await providerFetch<{ data?: OuraDoc[] }>(
      "oura",
      `${base}/sleep?${qs}`,
      { accessToken },
    );
    for (const d of detail.data ?? []) {
      // Oura keys a night to the morning you wake, which is what `bedtime_end`
      // gives us; `day` on this collection is the night it started.
      const day = d.bedtime_end ? dayOf(d.bedtime_end) : d.day;
      const secs = num(d.total_sleep_duration);
      if (secs !== undefined) push(out, "sleep_minutes", day, secondsToMinutes(secs), "oura");
      push(out, "hrv", day, num(d.average_hrv), "oura");
      push(out, "resting_heart_rate", day, num(d.lowest_heart_rate), "oura");
      // NOT spo2 here. It comes from `daily_spo2` above.
    }
    return out;
  },

  /**
   * Oura workouts. Shape from their generated v2 schema: `activity`, `calories`
   * (already kcal), `distance` in metres, `intensity` as a label, and a
   * `start_datetime`/`end_datetime` pair carrying a local offset.
   *
   * `day` is Oura's own answer for which day the session belongs to, so it is
   * used rather than re-derived from the timestamp. A late-evening session is
   * theirs to attribute, not ours to guess.
   */
  async fetchWorkouts({ accessToken, start, end }) {
    const res = await providerFetch<{ data?: OuraWorkout[] }>(
      "oura",
      `https://api.ouraring.com/v2/usercollection/workout?start_date=${start}&end_date=${end}`,
      { accessToken },
    );
    const out: WorkoutSession[] = [];
    for (const w of res.data ?? []) {
      if (!w?.id || !w.start_datetime || !w.end_datetime || !w.day) continue;
      out.push({
        externalId: w.id,
        startedAt: w.start_datetime,
        endedAt: w.end_datetime,
        date: w.day,
        activity: w.activity ?? undefined,
        intensity: w.intensity ?? undefined,
        calories: num(w.calories),
        distanceM: num(w.distance),
        source: w.source ?? undefined,
      });
    }
    return out;
  },

  /**
   * Oura's revoke, read off their authentication page on 2026-08-07.
   *
   * WHY IT TOOK A HUMAN TO GET THIS. The URL lives in a code block that every
   * extractor available here strips out of the page, so the endpoint sat
   * unimplemented for a day rather than being guessed at. A guessed revoke URL
   * returns a quiet 404 and leaves us believing we destroyed a member's grant
   * when we did not, which is a privacy claim we cannot support.
   *
   * TWO THINGS THEIR DOCS DO NOT SAY, both handled rather than assumed.
   *
   * The METHOD is not stated. RFC 7009 says revocation is a POST, and a
   * state-changing call should not be a GET, so POST is tried first. Their
   * example is a bare URL with a query string and no body, which is equally
   * consistent with a GET, so a 404/405 retries once as GET rather than
   * reporting a failure that is really a disagreement about verbs.
   *
   * The PROSE mentions `client_id` while the URL they print carries only
   * `access_token`. We send what the example shows. Adding an undocumented
   * parameter is the same guess in a smaller costume, and if Oura needed it
   * they would have put it in their own example.
   */
  async revoke({ accessToken, signal }) {
    const url =
      "https://api.ouraring.com/oauth/revoke" +
      `?access_token=${encodeURIComponent(accessToken)}`;
    const call = (method: "POST" | "GET") =>
      fetch(url, { method, headers: { Accept: "application/json" }, signal });

    let res = await call("POST");
    if (res.status === 404 || res.status === 405) res = await call("GET");

    // 401 means the token is already dead, which is the outcome we wanted.
    if (!res.ok && res.status !== 401) {
      throw new Error(`oura revoke ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Fitbit, via the Google Health API                                           */
/* -------------------------------------------------------------------------- */

/**
 * FITBIT NOW SPEAKS GOOGLE HEALTH, and this is a rewrite rather than an edit.
 *
 * The legacy Fitbit Web API is closed to new applications and is deprecated in
 * September 2026. Fitbit data now comes from `health.googleapis.com`, behind a
 * Google account and Google OAuth, with different endpoints, different scopes
 * and a different response format. Nothing of the old HTTP layer survived.
 *
 * WRITTEN FROM THE DISCOVERY DOCUMENT, NOT THE MIGRATION GUIDE. Google publish
 * a machine-readable spec at `health.googleapis.com/$discovery/rest?version=v4`
 * (revision 20260805), and it disagrees with their own prose in ways that would
 * each have cost a debugging session:
 *
 *   - The method is `dailyRollUp`, with a capital U. The migration guide writes
 *     it `dailyRollup`. One of those 404s.
 *   - Sleep and exercise are NOT in the rollup response at all. They are
 *     session types read through `list`.
 *   - The path uses kebab-case (`daily-heart-rate-variability`) while the
 *     filter expression for the same type uses snake_case
 *     (`daily_heart_rate_variability.date`). Both, in one request.
 *   - Sleep is explicitly excluded from the session civil-time filter and must
 *     be filtered on `sleep.interval.end_time` as RFC-3339 instead.
 *
 * THE ID STAYS `fitbit`. Members think Fitbit, the redirect URI is registered
 * against `/api/wearables/callback/fitbit`, and `wearable_connections.provider`
 * already uses it. Google Health is the pipe, not the brand.
 */

/** Google's `Date` message: a plain calendar date with no timezone. */
interface GDate {
  year?: number;
  month?: number;
  day?: number;
}

/** "2026-08-07" as Google's Date message. */
function gDate(iso: string): GDate {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

/** Google's Date message back to "YYYY-MM-DD", or undefined if unusable. */
function isoFromGDate(d: GDate | undefined): string | undefined {
  if (!d?.year || !d.month || !d.day) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** The day after `iso`, since every Google range is closed-open. */
function nextDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * The member's LOCAL calendar day for a session, from whatever Google gave us.
 *
 * `civilStartTime` is the right answer and is normally present. When it is not,
 * the fallback matters more than it looks: Google send `startTime` as
 * RFC-3339, and their `google-datetime` format is normally UTC-normalised, so
 * an 18:00 session in Los Angeles arrives as 01:00 the NEXT day. Taking the
 * date off that string would file the session on the wrong day and, at the
 * edge of a sync window, drop it entirely.
 *
 * `startUtcOffset` is supplied for exactly this, as a duration like "-25200s",
 * so the local day can be reconstructed rather than guessed. With neither, the
 * timestamp is read as written, which is the best available answer.
 */
export function googleLocalDay(
  civil: GDate | undefined,
  startTime: string | undefined,
  utcOffset: string | undefined,
): string | undefined {
  const fromCivil = isoFromGDate(civil);
  if (fromCivil) return fromCivil;
  if (!startTime) return undefined;

  const ms = Date.parse(startTime);
  const seconds = utcOffset ? Number(String(utcOffset).replace(/s$/, "")) : NaN;
  if (Number.isFinite(ms) && Number.isFinite(seconds)) {
    return new Date(ms + seconds * 1000).toISOString().slice(0, 10);
  }
  return dayOf(startTime);
}

/** A `list` response, narrowed to the one data field each call cares about. */
interface GDataPoint {
  name?: string;
  dataSource?: { recordingMethod?: string; platform?: string };
  dailyRestingHeartRate?: { beatsPerMinute?: string | number; date?: GDate };
  dailyHeartRateVariability?: {
    averageHeartRateVariabilityMilliseconds?: number;
    date?: GDate;
  };
  dailyOxygenSaturation?: { averagePercentage?: number; date?: GDate };
  dailyRespiratoryRate?: { breathsPerMinute?: number; date?: GDate };
  dailyVo2Max?: { vo2Max?: number; date?: GDate };
  dailySleepTemperatureDerivations?: {
    nightlyTemperatureCelsius?: number;
    baselineTemperatureCelsius?: number;
    date?: GDate;
  };
  sleep?: {
    summary?: { minutesAsleep?: string | number };
    metadata?: { nap?: boolean; mainSleep?: boolean; processed?: boolean };
    interval?: {
      startTime?: string;
      endTime?: string;
      startUtcOffset?: string;
      endUtcOffset?: string;
      civilStartTime?: { date?: GDate };
      civilEndTime?: { date?: GDate };
    };
  };
  exercise?: {
    displayName?: string;
    exerciseType?: string;
    interval?: {
      startTime?: string;
      endTime?: string;
      startUtcOffset?: string;
      civilStartTime?: { date?: GDate };
    };
    metricsSummary?: {
      caloriesKcal?: number;
      distanceMillimeters?: number;
      averageHeartRateBeatsPerMinute?: string | number;
    };
  };
}

/**
 * Google reports skin temperature as an absolute nightly reading plus a
 * baseline. Our `temperature_deviation` is the difference, signed.
 *
 * THIS IS THE WHOOP TRAP IN A NEW COAT. Legacy Fitbit sent `nightlyRelative`,
 * already a deviation, so it mapped straight across. Google sends roughly 33
 * degrees and a baseline near it; publishing the first as a deviation would put
 * a body temperature on a chart whose other points are fractions of a degree,
 * which is exactly why Whoop's `skin_temp_celsius` stayed unmapped.
 *
 * Without a baseline there is no deviation to report, and inventing one from a
 * population figure would be worse than a gap.
 */
export function googleTemperatureDeviation(
  nightly: number | undefined,
  baseline: number | undefined,
): number | undefined {
  const n = num(nightly);
  const b = num(baseline);
  if (n === undefined || b === undefined) return undefined;
  return Math.round((n - b) * 100) / 100;
}

/** Google Health's OAuth scopes. Four metrics now share one of them. */
const GOOGLE_HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
];

const GH_BASE = "https://health.googleapis.com/v4/users/me/dataTypes";

const fitbit: WearableProvider = {
  id: "fitbit",
  name: PROVIDER_NAMES.fitbit,
  blurb: "Steps, sleep and resting heart rate from Fitbit.",
  clientIdEnv: "FITBIT_CLIENT_ID",
  clientSecretEnv: "FITBIT_CLIENT_SECRET",

  // Google's own OAuth, not Fitbit's. The member signs in with a Google
  // account; a Fitbit login will not appear anywhere in this flow.
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",

  /**
   * THREE SCOPES WHERE THERE WERE SEVEN, and the collapse matters.
   *
   * `heartrate`, `oxygen_saturation`, `respiratory_rate` and `temperature`
   * were four separately declinable Fitbit scopes and are now one Google
   * bundle. Under the old API a member could decline SpO2 and keep HRV; here
   * those four arrive or refuse together. The defensive per-collection fetch
   * below still earns its place, but what it protects against has changed
   * shape: a partial refusal is now all-or-nothing across that bundle.
   */
  scopes: GOOGLE_HEALTH_SCOPES,

  /**
   * WITHOUT THESE TWO, GOOGLE ISSUES NO REFRESH TOKEN and every connection
   * dies within the hour with nothing in the logs to explain it. `access_type`
   * is what asks for one at all; `prompt` is what makes Google reissue it when
   * a member who has consented before reconnects, since it is sent exactly
   * once per grant otherwise. This is Whoop's `offline` scope in Google form,
   * and it cost that integration a day.
   */
  extraAuthParams: { access_type: "offline", prompt: "consent" },

  tokenAuth: "body",

  /**
   * Google does NOT rotate refresh tokens: the same one is reused, and the
   * refresh response omits the field entirely. `tokenColumns` only overwrites
   * when a vendor actually sends one, so the stored token survives.
   */
  refreshRotates: false,
  syncWindowDays: 7,

  async fetchRange({ accessToken, start, end }) {
    const out: DailyMetric[] = [];
    // Every Google range is closed-open, so the last day needs the day after.
    const endExclusive = nextDay(end);

    /**
     * A `list` call, tolerant of refusal.
     *
     * Each collection is wrapped because a member can decline a scope at the
     * consent screen, and letting that fail the whole sync would cost them
     * sleep and steps over a metric they chose not to share. A 403 here would
     * otherwise reach the sweep as `ReauthRequired` and mark the connection
     * dead outright.
     */
    /*
     * TALLIED, NOT SWALLOWED. The first version of this caught every failure
     * and returned an empty list, which quietly created the worst connection
     * state this codebase has: a member who declines the health scopes gets
     * 403 on every call, and would have seen `status: active`,
     * `failure_count: 0`, `last_error: null` and a Fitbit that is permanently
     * connected and permanently empty. Nothing would ever have said why. That
     * is the same shape as the August 3rd incident, where a row said connected
     * and had no credentials.
     *
     * So a partial refusal is still tolerated, and a TOTAL one is not: if
     * nothing at all succeeded, the first error is rethrown and the sync
     * records a real failure. That also restores 429 and 5xx to the failure
     * counter, which the blanket catch had hidden.
     */
    let succeeded = 0;
    let firstError: unknown = null;

    const list = async (dataType: string, filter: string): Promise<GDataPoint[]> => {
      try {
        const res = await providerFetch<{ dataPoints?: GDataPoint[] }>(
          "fitbit",
          `${GH_BASE}/${dataType}/dataPoints?filter=${encodeURIComponent(filter)}&pageSize=200`,
          { accessToken },
        );
        succeeded += 1;
        return res.dataPoints ?? [];
      } catch (err) {
        firstError ??= err;
        return [];
      }
    };

    /**
     * A daily summary collection.
     *
     * The path is kebab-case and the filter field is snake_case, for the same
     * data type, in the same request. That is Google's spec, not a typo here.
     */
    const daily = (dataType: string) =>
      list(
        dataType,
        `${dataType.replace(/-/g, "_")}.date >= "${start}" AND ` +
          `${dataType.replace(/-/g, "_")}.date < "${endExclusive}"`,
      );

    const [rhr, hrv, spo2, breathing, vo2, temp] = await Promise.all([
      daily("daily-resting-heart-rate"),
      daily("daily-heart-rate-variability"),
      daily("daily-oxygen-saturation"),
      daily("daily-respiratory-rate"),
      daily("daily-vo2-max"),
      daily("daily-sleep-temperature-derivations"),
    ]);

    for (const p of rhr) {
      const d = p.dailyRestingHeartRate;
      push(out, "resting_heart_rate", isoFromGDate(d?.date), num(d?.beatsPerMinute), "fitbit");
    }
    for (const p of hrv) {
      const d = p.dailyHeartRateVariability;
      // RMSSD, which is what every other vendor here reports. The deep-sleep
      // variant sits alongside it and is not comparable.
      push(
        out,
        "hrv",
        isoFromGDate(d?.date),
        num(d?.averageHeartRateVariabilityMilliseconds),
        "fitbit",
      );
    }
    for (const p of spo2) {
      const d = p.dailyOxygenSaturation;
      push(out, "spo2", isoFromGDate(d?.date), num(d?.averagePercentage), "fitbit");
    }
    for (const p of breathing) {
      const d = p.dailyRespiratoryRate;
      push(out, "respiratory_rate", isoFromGDate(d?.date), num(d?.breathsPerMinute), "fitbit");
    }
    for (const p of vo2) {
      // A plain number now. The legacy API sent a string that was sometimes a
      // range like "44-48", which needed parsing; that trap is gone.
      push(out, "vo2max", isoFromGDate(p.dailyVo2Max?.date), num(p.dailyVo2Max?.vo2Max), "fitbit");
    }
    for (const p of temp) {
      const d = p.dailySleepTemperatureDerivations;
      push(
        out,
        "temperature_deviation",
        isoFromGDate(d?.date),
        googleTemperatureDeviation(d?.nightlyTemperatureCelsius, d?.baselineTemperatureCelsius),
        "fitbit",
      );
    }

    /*
     * SLEEP, which filters differently from every other session type.
     *
     * Google exclude sleep from the civil-start-time filter and want
     * `sleep.interval.end_time` in RFC-3339 instead. Filtering on the END is
     * also the right question: a night belongs to the morning you wake, which
     * is the rule Oura's adapter follows for the same reason.
     */
    const sleeps = await list(
      "sleep",
      `sleep.interval.end_time >= "${start}T00:00:00Z" AND ` +
        `sleep.interval.end_time < "${endExclusive}T00:00:00Z"`,
    );
    for (const p of sleeps) {
      const s = p.sleep;
      if (!s) continue;
      // Naps share a day with the night they adjoin, and the upsert is keyed
      // on (user, provider, date, metric), so keeping them would let a 20
      // minute nap silently replace a full night. Both adapters that missed
      // this shipped the bug.
      if (s.metadata?.nap === true) continue;
      if (s.metadata?.mainSleep === false) continue;
      const day = googleLocalDay(
        s.interval?.civilEndTime?.date,
        s.interval?.endTime,
        s.interval?.endUtcOffset,
      );
      push(out, "sleep_minutes", day, num(s.summary?.minutesAsleep), "fitbit");
      // NO sleep score. Google Health exposes none, exactly as the legacy API
      // did not, and publishing sleep efficiency under `sleep_score` would put
      // a number beside Oura's that means something else.
    }

    /*
     * STEPS AND ACTIVE CALORIES, which are interval types and roll up.
     *
     * `dailyRollUp` is a POST with a closed-open civil range and a window size
     * in days. Note the capital U: Google's own migration guide writes
     * `dailyRollup`, and that spelling 404s.
     */
    const rollUp = async (dataType: string) => {
      try {
        const res = await providerFetch<{
          rollupDataPoints?: {
            civilStartTime?: { date?: GDate };
            steps?: { countSum?: string | number };
            activeEnergyBurned?: { kcalSum?: number };
          }[];
        }>("fitbit", `${GH_BASE}/${dataType}/dataPoints:dailyRollUp`, {
          accessToken,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            range: { start: { date: gDate(start) }, end: { date: gDate(endExclusive) } },
            windowSizeDays: 1,
          }),
        });
        succeeded += 1;
        return res;
      } catch (err) {
        firstError ??= err;
        return { rollupDataPoints: [] };
      }
    };

    const [stepRoll, energyRoll] = await Promise.all([
      rollUp("steps"),
      rollUp("active-energy-burned"),
    ]);
    for (const r of stepRoll.rollupDataPoints ?? []) {
      push(out, "steps", isoFromGDate(r.civilStartTime?.date), num(r.steps?.countSum), "fitbit");
    }
    for (const r of energyRoll.rollupDataPoints ?? []) {
      push(
        out,
        "active_calories",
        isoFromGDate(r.civilStartTime?.date),
        num(r.activeEnergyBurned?.kcalSum),
        "fitbit",
      );
    }

    // NOTHING WORKED AT ALL is a failure, not an empty week. Declining every
    // scope, a dead grant and Google having a bad afternoon all land here, and
    // all three deserve to reach the sweep rather than presenting as a healthy
    // connection with no data. A ReauthRequired rethrown here still means
    // reauth; anything else counts against the failure budget.
    if (succeeded === 0 && firstError !== null) throw firstError;

    return out;
  },

  /**
   * Exercise sessions.
   *
   * `recordingMethod` IS THE AUTO-DETECTED SIGNAL, and it is better than what
   * the legacy API gave us. Fitbit's `logType` had to be pattern-matched
   * against a list of strings; Google state the recording method as an enum, so
   * `PASSIVELY_MEASURED` means the device noticed the session and anything else
   * means a person was involved. That maps straight onto migration 0021's
   * `auto_detected`, which keeps an auto-logged walk out of the training-day
   * count without discarding it.
   *
   * `UNSPECIFIED` and `UNKNOWN` are NOT treated as auto-detected. False there
   * means "they do not say", not "we know it was deliberate", which is the same
   * rule every other provider follows.
   */
  async fetchWorkouts({ accessToken, start, end }) {
    const endExclusive = nextDay(end);
    const res = await providerFetch<{ dataPoints?: GDataPoint[] }>(
      "fitbit",
      `${GH_BASE}/exercise/dataPoints?pageSize=200&filter=` +
        encodeURIComponent(
          `exercise.interval.civil_start_time >= "${start}" AND ` +
            `exercise.interval.civil_start_time < "${endExclusive}"`,
        ),
      { accessToken },
    );

    const out: WorkoutSession[] = [];
    for (const p of res.dataPoints ?? []) {
      if (!p || typeof p !== "object") continue;
      const e = p.exercise;
      const startedAt = e?.interval?.startTime;
      const endedAt = e?.interval?.endTime;
      if (!e || !startedAt || !endedAt) continue;

      const date = googleLocalDay(
        e.interval?.civilStartTime?.date,
        startedAt,
        e.interval?.startUtcOffset,
      );
      if (!date || date < start || date > end) continue;

      const metrics = e.metricsSummary;
      const distanceMm = num(metrics?.distanceMillimeters);

      out.push({
        // `name` is Google's own identifier and is the stable half of the
        // idempotency key. Sessions without one fall back to their start and
        // type, which is unique enough: a member cannot begin two exercises of
        // the same kind at the same instant.
        externalId: p.name ?? `${startedAt}:${e.exerciseType ?? "exercise"}`,
        startedAt,
        endedAt,
        date,
        activity: e.displayName ?? undefined,
        calories: num(metrics?.caloriesKcal),
        // MILLIMETRES. Not metres, and not the locale-dependent unit the
        // legacy API used, which had to be read from a `distanceUnit` field.
        distanceM: distanceMm === undefined ? undefined : Math.round(distanceMm / 1000),
        avgHeartRate: num(metrics?.averageHeartRateBeatsPerMinute),
        autoDetected: p.dataSource?.recordingMethod === "PASSIVELY_MEASURED",
        source: p.dataSource?.platform ?? undefined,
      });
    }
    return out;
  },

  /**
   * Google's standard OAuth revocation, which takes either token and kills the
   * whole grant. Documented at `oauth2.googleapis.com/revoke`, unlike Oura's,
   * which had to be read off a page by hand.
   */
  async revoke({ accessToken, refreshToken, signal }) {
    const res = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken ?? accessToken }),
      signal,
    });
    // 400 is what Google answer for a token that is already invalid, which is
    // the outcome we wanted.
    if (!res.ok && res.status !== 400) {
      throw new Error(`google health revoke ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Whoop                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Whoop's v2 sleep record, modelled on their documented example.
 *
 * THE SHAPE THAT BIT US: `stage_summary` lives INSIDE `score`, not beside it.
 * The first version of this adapter read `sleep.stage_summary`, which is always
 * undefined, so `sleep_minutes` was never emitted at all. Nothing failed and
 * nothing logged; the metric was simply absent, which is the hardest kind of
 * wrong to notice.
 */
interface WhoopSleep {
  id?: string;
  start?: string;
  end?: string;
  /** Naps are separate records from the night. See fetchRange. */
  nap?: boolean;
  /** "SCORED" | "PENDING_SCORE" | "UNSCORABLE". Only the first has a score. */
  score_state?: string;
  score?: {
    stage_summary?: {
      total_in_bed_time_milli?: number;
      total_awake_time_milli?: number;
      total_no_data_time_milli?: number;
      total_light_sleep_time_milli?: number;
      total_slow_wave_sleep_time_milli?: number;
      total_rem_sleep_time_milli?: number;
    };
    respiratory_rate?: number;
    sleep_performance_percentage?: number;
    sleep_efficiency_percentage?: number;
  };
}

/**
 * Whoop's v2 workout record, from their documented example.
 *
 * `sport_id` is gone: their docs say it "will not exist past 09/01/2025", so
 * `sport_name` is the only safe source for the activity.
 */
interface WhoopWorkout {
  id?: string;
  start?: string;
  end?: string;
  sport_name?: string;
  score_state?: string;
  score?: {
    strain?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
    /** KILOJOULES, not calories. Converted before it leaves this adapter. */
    kilojoule?: number;
    distance_meter?: number;
  };
}

/**
 * Whoop's page size, and their documented maximum.
 *
 * Asking for fewer would only mean more round trips for the same records.
 */
const WHOOP_PAGE_SIZE = 25;

/**
 * How many pages one collection may walk before we stop asking.
 *
 * A BOUND, NOT A BUDGET. The windows below are chosen so this is never
 * reached: 60 days of nights is about three pages, and even a member training
 * twice a day fills six. It exists because a paginating loop against somebody
 * else's service is the classic way to hang a Worker, and "the vendor kept
 * handing us a token" is not a scenario we can rule out from here. Twelve
 * pages is 300 records, comfortably more than any window we ask for, and a
 * ceiling that costs nothing when it is not hit.
 */
const WHOOP_MAX_PAGES = 12;

/**
 * Walk a Whoop collection to the end of the window.
 *
 * WHY THIS EXISTS. Every one of these endpoints caps a page at 25 records and
 * returns `next_token` when there are more. The first version of this adapter
 * asked for one page and stopped, which was correct for the 7-day sync window
 * it was written against and quietly wrong the moment we asked for more: a
 * member connecting Whoop for the first time got a week of history, and the
 * two months of recovery already sitting in Whoop's account appeared only as
 * the nightly sweep inched forward a day at a time. The backfill is the reason
 * this function was written; see `backfillWindowDays` in types.ts.
 *
 * The request parameter is `nextToken` and the response field is `next_token`.
 * They are genuinely spelled differently, and mixing them up fails silently:
 * an unrecognised query parameter is ignored, so the loop would re-fetch page
 * one forever, which is what the repeat guard below catches.
 */
async function whoopPages<T>(
  url: string,
  accessToken: string,
): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  let nextToken: string | undefined;

  for (let page = 0; page < WHOOP_MAX_PAGES; page += 1) {
    const paged = nextToken
      ? `${url}&nextToken=${encodeURIComponent(nextToken)}`
      : url;
    const res = await providerFetch<{ records?: T[]; next_token?: string }>(
      "whoop",
      paged,
      { accessToken },
    );
    for (const r of res.records ?? []) out.push(r);

    const token = typeof res.next_token === "string" ? res.next_token : "";
    // No token means the collection is exhausted, which is the normal exit.
    if (!token) break;
    // A repeated token means we are not advancing. Stopping loses the tail of
    // a window; not stopping spends the request budget on the same 25 records
    // until the Worker is killed, and takes the sync with it.
    if (seen.has(token)) {
      console.warn("whoop returned a repeated next_token, stopping pagination");
      break;
    }
    seen.add(token);
    nextToken = token;
  }
  return out;
}

/** Whoop's v2 recovery record. Field names verified against their docs. */
interface WhoopRecovery {
  cycle_id?: number;
  sleep_id?: string;
  created_at?: string;
  score_state?: string;
  score?: {
    /** True during a new member's first weeks, when the score is not yet meaningful. */
    user_calibrating?: boolean;
    recovery_score?: number;
    resting_heart_rate?: number;
    hrv_rmssd_milli?: number;
    spo2_percentage?: number;
    /** ABSOLUTE skin temperature, not a deviation from baseline. Not mapped. */
    skin_temp_celsius?: number;
  };
}

const whoop: WearableProvider = {
  id: "whoop",
  name: PROVIDER_NAMES.whoop,
  blurb: "Recovery, strain and sleep performance from WHOOP.",
  clientIdEnv: "WHOOP_CLIENT_ID",
  clientSecretEnv: "WHOOP_CLIENT_SECRET",
  authorizeUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
  tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
  // ONLY WHAT WE READ. Whoop's own guidance is to request nothing more, and a
  // consent screen listing access we never use is both worse to read and worse
  // to justify. `read:profile` was dropped for exactly that reason: it returns
  // the member's name and email and we call no profile endpoint.
  //
  // `read:cycles` is kept despite our not calling /cycle directly, because
  // Whoop's own recovery documentation says recovery is reached "through the
  // Cycle endpoints in the V2 API". Cheap insurance against a 403 that would
  // otherwise cost a re-consent from every connected member.
  //
  // `offline` is the one that matters: without it Whoop issues no refresh
  // token and every connection dies within the hour.
  // `read:workout` was added when workout sync landed, and is on Whoop's
  // published scope list.
  scopes: ["read:sleep", "read:recovery", "read:cycles", "read:workout", "offline"],
  tokenAuth: "body",
  refreshRotates: true,
  syncWindowDays: 7,
  /*
   * SIXTY DAYS ON THE FIRST SYNC. Recovery, HRV and resting heart rate are
   * only legible against their own history: one week of dots is not a trend,
   * and a member who has worn the strap for months should not have to wait for
   * the nightly sweep to walk their own data forward a day at a time. Whoop
   * holds the history and hands it over on request, so the only reason we were
   * not showing it was that we never asked.
   *
   * Sixty rather than everything: it covers the 30-day window every screen
   * charts with room to spare, and it is four pages per collection rather than
   * an unbounded crawl through somebody's entire membership on a request they
   * are watching a spinner on.
   */
  backfillWindowDays: 60,
  async fetchRange({ accessToken, start, end }) {
    const out: DailyMetric[] = [];
    // v2. Their v1 to v2 guide maps every path we use one for one, v1 webhooks
    // are already removed, and new features land on v2 first.
    const api = "https://api.prod.whoop.com/developer/v2";
    const range = `start=${start}T00:00:00.000Z&end=${end}T23:59:59.999Z`;

    const sleepRecords = await whoopPages<WhoopSleep>(
      `${api}/activity/sleep?${range}&limit=${WHOOP_PAGE_SIZE}`,
      accessToken,
    );
    for (const s of sleepRecords) {
      // A null or non-object element must not take down the whole sync, and
      // "the vendor sent something odd" is a normal day.
      if (!s || typeof s !== "object") continue;
      // NAPS ARE SEPARATE RECORDS and share the day with the night they
      // adjoin. Keeping them would emit two `sleep_minutes` for one date, and
      // since the upsert is keyed on (user, provider, date, metric) the last
      // one written wins: a 20-minute nap would silently replace a full night.
      if (s.nap) continue;
      // Anything not SCORED has no usable score. PENDING_SCORE and UNSCORABLE
      // both appear in normal use.
      if (s.score_state && s.score_state !== "SCORED") continue;

      const day = s.end ? dayOf(s.end) : undefined;
      const stages = s.score?.stage_summary;

      // ASLEEP IS THE SUM OF THE STAGES, not in-bed minus awake. Whoop reports
      // `total_no_data_time_milli` as well, so the subtraction quietly counts
      // sensor gaps as sleep. Adding the three real stages is exact.
      const light = num(stages?.total_light_sleep_time_milli) ?? 0;
      const deep = num(stages?.total_slow_wave_sleep_time_milli) ?? 0;
      const rem = num(stages?.total_rem_sleep_time_milli) ?? 0;
      const asleepMs = light + deep + rem;
      if (asleepMs > 0) {
        push(out, "sleep_minutes", day, Math.round(asleepMs / 60000), "whoop");
      }

      const perf = num(s.score?.sleep_performance_percentage);
      if (perf !== undefined) push(out, "sleep_score", day, clampScore(perf), "whoop");
      push(out, "respiratory_rate", day, num(s.score?.respiratory_rate), "whoop");
    }

    const recoveryRecords = await whoopPages<WhoopRecovery>(
      `${api}/recovery?${range}&limit=${WHOOP_PAGE_SIZE}`,
      accessToken,
    );
    for (const r of recoveryRecords) {
      if (!r || typeof r !== "object") continue;
      if (r.score_state && r.score_state !== "SCORED") continue;
      // Recovery is computed on waking, so `created_at` is the morning it
      // describes, which is the same day every other adapter keys a night to.
      const day = r.created_at ? dayOf(r.created_at) : undefined;

      // WHILE CALIBRATING, the recovery score is not yet meaningful: Whoop
      // flags it themselves during a new member's first weeks. The underlying
      // measurements are real and are kept; only the composite is skipped.
      const score = num(r.score?.recovery_score);
      // Whoop's recovery answers the same question as Oura's readiness, so it
      // normalizes onto the same key rather than inventing a second one.
      if (score !== undefined && r.score?.user_calibrating !== true) {
        push(out, "readiness_score", day, clampScore(score), "whoop");
      }
      push(out, "hrv", day, num(r.score?.hrv_rmssd_milli), "whoop");
      push(out, "resting_heart_rate", day, num(r.score?.resting_heart_rate), "whoop");
      push(out, "spo2", day, num(r.score?.spo2_percentage), "whoop");

      // NOT MAPPED: `skin_temp_celsius` is an absolute reading, while our
      // `temperature_deviation` is a difference from the wearer's own
      // baseline. Charting one as the other would put ~33 next to ~-0.2.
    }
    return out;
  },

  /**
   * Whoop workouts.
   *
   * TWO TRAPS, both from their documented payload. Energy is in KILOJOULES, so
   * storing `kilojoule` in a kcal column would overstate every session by 4.184
   * and look merely like an enthusiastic athlete. And `sport_id` is retired
   * ("will not exist past 09/01/2025"), so `sport_name` is the only safe source
   * for the activity.
   *
   * A workout is keyed to the day it STARTED. Whoop gives no `day` field, and a
   * session that crosses midnight belongs to the day you began it, which is
   * also how anybody describes their own training.
   */
  async fetchWorkouts({ accessToken, start, end }) {
    const records = await whoopPages<WhoopWorkout>(
      `https://api.prod.whoop.com/developer/v2/activity/workout` +
        `?start=${start}T00:00:00.000Z&end=${end}T23:59:59.999Z&limit=${WHOOP_PAGE_SIZE}`,
      accessToken,
    );
    const out: WorkoutSession[] = [];
    for (const w of records) {
      if (!w || typeof w !== "object") continue;
      if (!w.id || !w.start || !w.end) continue;
      // PENDING_SCORE and UNSCORABLE both occur normally. The session is real
      // either way, so it is stored; only the score fields are withheld.
      const scored = w.score_state === undefined || w.score_state === "SCORED";
      const kj = scored ? num(w.score?.kilojoule) : undefined;
      out.push({
        externalId: w.id,
        startedAt: w.start,
        endedAt: w.end,
        date: dayOf(w.start),
        activity: w.sport_name ?? undefined,
        strain: scored ? num(w.score?.strain) : undefined,
        // 1 kcal is 4.184 kJ.
        calories: kj === undefined ? undefined : Math.round(kj / 4.184),
        distanceM: scored ? num(w.score?.distance_meter) : undefined,
        avgHeartRate: scored ? num(w.score?.average_heart_rate) : undefined,
        maxHeartRate: scored ? num(w.score?.max_heart_rate) : undefined,
      });
    }
    return out;
  },

  /**
   * Whoop's `revokeUserOAuthAccess`: DELETE /developer/v2/user/access, carrying
   * the member's own access token, answering 204.
   *
   * Their documentation asks for this directly: "When a user disables your
   * integration, you should revoke their access token from your application to
   * respect their privacy." Doing it also stops any webhooks for that member,
   * which matters more here than for the others.
   */
  async revoke({ accessToken, signal }) {
    const res = await fetch("https://api.prod.whoop.com/developer/v2/user/access", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal,
    });
    // 404 means the grant was already gone, which is the outcome we wanted.
    if (!res.ok && res.status !== 404) {
      throw new Error(`whoop revoke ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Withings                                                                    */
/* -------------------------------------------------------------------------- */

const withings: WearableProvider = {
  id: "withings",
  name: PROVIDER_NAMES.withings,
  blurb: "Weight, body composition and sleep from Withings scales and watches.",
  clientIdEnv: "WITHINGS_CLIENT_ID",
  clientSecretEnv: "WITHINGS_CLIENT_SECRET",
  authorizeUrl: "https://account.withings.com/oauth2_user/authorize2",
  tokenUrl: "https://wbsapi.withings.net/v2/oauth2",
  scopes: ["user.metrics", "user.activity"],
  tokenAuth: "body",
  refreshRotates: true,
  syncWindowDays: 14,
  async fetchRange({ accessToken, start, end }) {
    const out: DailyMetric[] = [];

    // Withings is RPC-over-POST with an `action` field, not REST.
    const body = new URLSearchParams({
      action: "getmeas",
      meastypes: "1,6", // 1 = weight (kg), 6 = fat ratio (%)
      category: "1",
      startdate: String(Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000)),
      enddate: String(Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000)),
    });
    const res = await providerFetch<{
      body?: { measuregrps?: { date?: number; measures?: { value?: number; type?: number; unit?: number }[] }[] };
    }>("withings", "https://wbsapi.withings.net/measure", {
      method: "POST",
      accessToken,
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    for (const g of res.body?.measuregrps ?? []) {
      if (!g.date) continue;
      const day = new Date(g.date * 1000).toISOString().slice(0, 10);
      for (const m of g.measures ?? []) {
        // Withings encodes decimals as value x 10^unit, where unit is negative.
        const v = num(m.value);
        if (v === undefined) continue;
        const scaled = v * Math.pow(10, m.unit ?? 0);
        if (m.type === 1) push(out, "weight_kg", day, Number(scaled.toFixed(2)), "withings");
        if (m.type === 6) push(out, "body_fat_pct", day, Number(scaled.toFixed(2)), "withings");
      }
    }
    return out;
  },
};

/* -------------------------------------------------------------------------- */
/* Garmin, push only                                                          */
/* -------------------------------------------------------------------------- */

const garmin: WearableProvider = {
  id: "garmin",
  name: PROVIDER_NAMES.garmin,
  blurb: "Steps, sleep, stress and HRV from Garmin watches.",
  clientIdEnv: "GARMIN_CLIENT_ID",
  clientSecretEnv: "GARMIN_CLIENT_SECRET",
  authorizeUrl: "https://connect.garmin.com/oauth2Confirm",
  tokenUrl: "https://diauth.garmin.com/di-oauth2-service/oauth/token",
  scopes: ["HEALTH_EXPORT"],
  tokenAuth: "basic",
  refreshRotates: true,
  syncWindowDays: 0,
  requiresApproval: true,
  /**
   * NULL ON PURPOSE. Garmin's Health API does not support on-demand fetching at
   * all, it pushes to a registered webhook when data lands, and there is no
   * endpoint to ask "what happened last Tuesday". Everything else here polls;
   * Garmin cannot, so the sync sweep skips it and `/api/wearables/garmin-push`
   * is the only way its data arrives.
   *
   * The practical consequence: a Garmin user who connects sees nothing until
   * their watch next syncs, which is a support question worth pre-empting in
   * the UI rather than a bug.
   */
  fetchRange: null,
};

/* -------------------------------------------------------------------------- */
/* Ultrahuman                                                                  */
/* -------------------------------------------------------------------------- */

const ultrahuman: WearableProvider = {
  id: "ultrahuman",
  name: PROVIDER_NAMES.ultrahuman,
  blurb: "Sleep, recovery and HRV from the Ultrahuman Ring.",
  clientIdEnv: "ULTRAHUMAN_CLIENT_ID",
  clientSecretEnv: "ULTRAHUMAN_CLIENT_SECRET",

  // British spelling, and a dedicated auth host. Ultrahuman's own spec text
  // says "/authorize" while every worked example uses "/authorise"; the
  // examples win here, because they are what their integrations actually call.
  // If consent ever 404s, try the American spelling before assuming anything
  // else is wrong.
  authorizeUrl: "https://auth.ultrahuman.com/authorise",
  tokenUrl: "https://partner.ultrahuman.com/api/partners/oauth/token",

  // `ring_data` is the ring itself.
  //
  // `profile` is REQUESTED BUT NOT YET USED, which is a deliberate exception to
  // "never ask for a scope you do not need". Unlike every other vendor here,
  // Ultrahuman's token response carries no user identifier at all, and their
  // /user_info endpoint (which needs this scope) is the only way to learn one.
  // We do not call it yet, so `external_user_id` stays null for Ultrahuman
  // connections and nothing depends on it: `fetchRange` below never reads it.
  //
  // The scope is kept rather than dropped because changing a scope list forces
  // every existing connection back through consent, and it is cheaper to hold
  // one unused scope than to pay that twice, once to remove it and once to add
  // it back when /user_info is wired up. See docs/WEARABLES.md.
  //
  // `cgm_data` unlocks glucose from the M1, on this same endpoint. Requested
  // because glucose is genuinely analytical for us: it is the one wearable
  // signal that moves against a blood panel on the same axis the panel
  // measures. A user without a CGM simply has no glucose entries, so asking for
  // the scope costs them nothing.
  scopes: ["profile", "ring_data", "cgm_data"],
  tokenAuth: "body",

  // Confirmed in their docs, not assumed: "next time you refresh the tokens
  // make sure to use the newly granted refresh token".
  refreshRotates: true,

  // DELIBERATELY SHORT, because this endpoint takes ONE DAY PER REQUEST. Seven
  // days would be seven subrequests per user per sync, and the sweep runs up to
  // 50 users per invocation, which is how a Worker hits its subrequest ceiling.
  // Three days still covers a missed night plus a late correction.
  syncWindowDays: 3,
  requiresApproval: true,

  async fetchRange({ accessToken, start, end }) {
    const out: DailyMetric[] = [];
    const api = "https://partner.ultrahuman.com/api/partners/v1";

    const days = daysBetween(start, end);
    let failed = 0;
    let lastFailure = "";

    // One request per day. `date` is the only parameter this endpoint accepts:
    // there is no range form on the OAuth API. (The separate personal-token API
    // does accept start_epoch/end_epoch, but that is a different host, a
    // different auth header, and not what we ship.)
    for (const day of days) {
      let res: UltrahumanMetricsResponse;
      try {
        res = await providerFetch<UltrahumanMetricsResponse>(
          "ultrahuman",
          `${api}/user_data/metrics?date=${day}`,
          { accessToken },
        );
      } catch (err) {
        // A dead grant is not a missing day. Swallowing it would report a
        // revoked connection as "synced, no data" forever.
        if (err instanceof ReauthRequired) throw err;
        // One missing day must not abandon the rest of the window. A ring that
        // was off the charger for a night simply has nothing for that date.
        failed += 1;
        lastFailure = err instanceof Error ? err.message : String(err);
        continue;
      }

      // `data.metrics` is a map keyed by date string, each holding an array of
      // { type, object } entries. Not a flat object, and not an array of days.
      for (const [date, entries] of Object.entries(res.data?.metrics ?? {})) {
        const by = new Map<string, UltrahumanEntryObject>();
        for (const e of entries ?? []) {
          if (e?.type && e.object) by.set(e.type, e.object);
        }
        const val = (t: string) => num(by.get(t)?.value);
        const avg = (t: string) => num(by.get(t)?.avg);

        // Seconds in their payload ("unit": "seconds"), minutes in ours.
        const sleepSecs = val("total_sleep");
        if (sleepSecs !== undefined) {
          push(out, "sleep_minutes", date, secondsToMinutes(sleepSecs), "ultrahuman");
        }

        const sleepScore = val("sleep_score");
        if (sleepScore !== undefined) {
          push(out, "sleep_score", date, clampScore(sleepScore), "ultrahuman");
        }

        // Two HRV figures exist. `avg_sleep_hrv` is the overnight one, which is
        // what a recovery reading means and what every other adapter here
        // reports; `hrv` is an all-day average. Prefer overnight, fall back.
        const hrv = val("avg_sleep_hrv") ?? avg("hrv");
        push(out, "hrv", date, hrv, "ultrahuman");

        // Same pattern: `sleep_rhr` is the sleeping figure, `night_rhr` carries
        // its value in `avg` rather than `value`.
        const rhr = val("sleep_rhr") ?? avg("night_rhr");
        push(out, "resting_heart_rate", date, rhr, "ultrahuman");

        const recovery = val("recovery_index");
        if (recovery !== undefined) {
          push(out, "readiness_score", date, clampScore(recovery), "ultrahuman");
        }

        // Daily total, not the per-reading average.
        push(out, "steps", date, num(by.get("steps")?.total), "ultrahuman");
        push(out, "spo2", date, avg("spo2"), "ultrahuman");
        push(out, "vo2max", date, val("vo2_max"), "ultrahuman");

        // A deviation, and legitimately negative. Distinct from `temp` and
        // `average_body_temperature`, which are absolute skin readings.
        push(out, "temperature_deviation", date, val("temperature_deviation"), "ultrahuman");

        // Glucose, present only when the user wears an M1 and granted
        // `cgm_data`. Daily summaries only: the raw `glucose` entry is a
        // reading every few minutes, which is a time series and does not
        // belong at a one-row-per-day grain.
        push(out, "glucose_avg", date, val("average_glucose"), "ultrahuman");
        push(out, "glucose_variability", date, val("glucose_variability"), "ultrahuman");
        push(out, "glucose_time_in_target", date, val("time_in_target"), "ultrahuman");

        // CGM-ESTIMATED, and stored under its own key so it can never be
        // mistaken for the lab HbA1c our biomarker catalog already holds.
        push(out, "hba1c_estimated", date, val("hba1c"), "ultrahuman");

        // Ultrahuman's own composite, not a measurement of anything. Clamped
        // like any other score, and single-vendor by nature: nothing else here
        // computes one, and if something did it would not be the same number.
        const metabolic = val("metabolic_score");
        if (metabolic !== undefined) {
          push(out, "metabolic_score", date, clampScore(metabolic), "ultrahuman");
        }

        // NOT AVAILABLE, deliberately absent rather than forgotten:
        //   active_calories   no calories field exists anywhere in the payload;
        //                     `active_minutes` is minutes and not the same thing
        //   respiratory_rate  not reported
        //   weight_kg,
        //   body_fat_pct      a ring cannot measure either
      }
    }

    /*
     * EVERY DAY FAILING IS NOT "NO DATA". It is the endpoint not answering.
     *
     * Per-day `continue` is right for a ring that was on the charger, and it
     * was silently wrong for everything else: a bad host, a wrong path or a
     * vendor outage produced an empty array, `storeMetrics` stored nothing,
     * and `syncConnection` then recorded a SUCCESS and stamped `last_sync_at`.
     * A completely broken integration reported itself healthy forever, and
     * nothing in the database or the logs said otherwise.
     *
     * That mattered concretely: a set `last_sync_at` was read as proof the
     * metrics host was right, which it never was. Throwing here is what makes
     * that stamp mean something, because now it can only appear when at least
     * one request actually succeeded.
     */
    if (days.length > 0 && failed === days.length) {
      throw new Error(
        `ultrahuman metrics returned nothing for all ${days.length} day(s): ${lastFailure}`,
      );
    }
    return out;
  },
};

/* -------------------------------------------------------------------------- */

export const PROVIDERS: Record<ProviderId, WearableProvider> = {
  oura,
  fitbit,
  whoop,
  withings,
  garmin,
  ultrahuman,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(v: string): v is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, v);
}

/**
 * Configured = both env vars present.
 *
 * Anything unconfigured is hidden from the connect UI rather than shown and
 * failing at the redirect, which is where an unset client id would otherwise
 * surface, as a vendor error page with our name on it.
 */
export function providerConfigured(p: WearableProvider): boolean {
  // `unavailable` wins over credentials, deliberately. A provider whose API we
  // can no longer reach must not be switchable on by setting two env vars,
  // because the failure that produces is a Connect button leading to a vendor
  // screen that 400s, which reads to a member as our bug.
  if (p.unavailable) return false;
  return Boolean(process.env[p.clientIdEnv] && process.env[p.clientSecretEnv]);
}

export function configuredProviders(): WearableProvider[] {
  return PROVIDER_IDS.map((id) => PROVIDERS[id]).filter(providerConfigured);
}
