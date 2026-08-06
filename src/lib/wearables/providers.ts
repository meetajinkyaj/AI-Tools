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
};

/* -------------------------------------------------------------------------- */
/* Fitbit                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Fitbit's VO2 max, which is a STRING and is sometimes a RANGE.
 *
 * Their documented example returns both forms: `"45"` and `"44-48"`. They only
 * give a single number when the user runs with GPS; otherwise it is a band.
 *
 * `Number("44-48")` is NaN, so passing this through the usual numeric helper
 * would drop every ranged reading silently, and the metric would look like it
 * simply never arrives for anyone who does not run with GPS. The midpoint is
 * the honest reading of a band, and it keeps the series continuous when a user
 * moves between the two forms.
 */
export function fitbitVo2Max(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const band = raw.match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/);
  if (band) {
    const lo = Number(band[1]);
    const hi = Number(band[2]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
    return Math.round(((lo + hi) / 2) * 10) / 10;
  }
  return num(raw);
}

/** One entry from Fitbit's activity log list. */
interface FitbitActivity {
  logId?: number | string;
  activityName?: string;
  /** Local time with an offset, e.g. "2026-08-03T12:08:29.000-08:00". */
  startTime?: string;
  /** Milliseconds, INCLUDING pauses. `activeDuration` excludes them. */
  duration?: number;
  activeDuration?: number;
  calories?: number;
  /** In whatever `distanceUnit` says, which is not always metric. */
  distance?: number;
  distanceUnit?: string;
  averageHeartRate?: number;
  /** manual | mobile_run | tracker | auto_detected | fitstar | an app name. */
  logType?: string;
  /** An OBJECT here, unlike Oura's plain string. */
  source?: { name?: string } | null;
}

/**
 * Fitbit's distance, in metres, or undefined when we cannot tell the unit.
 *
 * THIS IS THE UNIT TRAP THIS REPO KEEPS FALLING INTO. Fitbit's data dictionary
 * says distance comes back in "units defined by the Accept-Language header",
 * and their own published examples show `"distanceUnit": "Mile"` alongside a
 * bare number. Reading `distance` as kilometres would understate an American
 * member's run by 38% and nothing would fail.
 *
 * So the unit is read from the payload, and an unrecognised one yields nothing
 * rather than a guess. A missing distance is a blank field; a wrong one is a
 * lie in a health record.
 */
export function fitbitDistanceMetres(
  distance: number | undefined,
  unit: string | undefined,
): number | undefined {
  const d = num(distance);
  if (d === undefined || !unit) return undefined;
  const factor: Record<string, number> = {
    kilometer: 1000,
    kilometre: 1000,
    km: 1000,
    meter: 1,
    metre: 1,
    m: 1,
    mile: 1609.344,
    mi: 1609.344,
    yard: 0.9144,
    foot: 0.3048,
    feet: 0.3048,
  };
  const f = factor[unit.trim().toLowerCase()];
  return f === undefined ? undefined : Math.round(d * f);
}

/**
 * Fitbit's `logType` values that mean the watch noticed it rather than the
 * member starting it.
 *
 * WHY THIS IS LABELLED AND NOT DISCARDED. Fitbit's SmartTrack logs a "Walk"
 * after roughly fifteen minutes of sustained movement, unasked. The first cut
 * of this adapter dropped short auto-detected sessions outright, so that a
 * member who walks to the station twice a day would not open the Training card
 * to seven training days out of seven, having trained on none.
 *
 * That protected the training number by throwing away real data. A walk is
 * movement, and movement is most of what this app is about; everyday activity
 * acts on bone, muscle, gut and metabolic health whether or not anybody would
 * call it a workout. So every session is stored, and the distinction travels
 * with it.
 *
 * INTENT IS THE LINE, NOT DURATION. Started by the member means training. Noticed
 * by the device means movement. No per-sport thresholds to argue about, one
 * sentence to explain, and somebody who considers their auto-detected hour a
 * real session can log it at check-in, which the training view already
 * reconciles per day.
 *
 * `fitstar` is Fitbit's own guided-workout app, which the member does start,
 * so it is deliberately NOT here.
 */
const FITBIT_AUTO_LOG_TYPES = new Set(["auto_detected"]);

/**
 * FITBIT, AND WHY THIS ENTIRE ADAPTER IS NOW UNREACHABLE.
 *
 * Everything below is written against the LEGACY Fitbit Web API, and that API
 * is closed to us in both directions:
 *
 *   - New applications can no longer be registered. `dev.fitbit.com`'s
 *     registration form now says so outright and points at Google.
 *   - The legacy Web API is deprecated in September 2026.
 *
 * Fitbit access now runs through the GOOGLE HEALTH API, which is a different
 * API rather than a renamed one: `health.googleapis.com`, Google OAuth against
 * a Google account rather than a Fitbit login, `dailyRollup`/`list` methods in
 * place of the hundred-odd legacy endpoints, new response shapes, and three
 * Google scope URLs where this asks for seven Fitbit short strings. Google
 * state plainly that existing tokens do not carry over.
 *
 * WHY IT IS KEPT RATHER THAN DELETED. The metric selection, the day
 * attribution rules and the two traps found while writing it (VO2 max arriving
 * as a range, distance arriving in whatever unit the account's locale implies)
 * are all still true of Fitbit's data and all still needed by the rewrite.
 * Deleting it would throw away the audit and keep only the mistakes.
 *
 * WHY IT IS MARKED `unavailable` RATHER THAN LEFT ALONE. An unconfigured
 * provider is already hidden, so the danger was never that a member sees it.
 * The danger is somebody reading a complete, audited adapter and concluding
 * Fitbit is one registration away, then spending an afternoon producing
 * credentials nothing here can call. The flag makes the file say what is true.
 *
 * Verified against Google's own migration, scopes and setup pages on
 * 2026-08-06. Details and the rewrite plan are in `docs/WEARABLES.md`.
 */
const fitbit: WearableProvider = {
  id: "fitbit",
  name: PROVIDER_NAMES.fitbit,
  blurb: "Steps, sleep and resting heart rate from Fitbit.",
  unavailable:
    "Fitbit moved to the Google Health API. This adapter targets the legacy " +
    "Fitbit Web API, which is closed to new applications and is deprecated in " +
    "September 2026, so it must be rewritten before Fitbit can be connected.",
  clientIdEnv: "FITBIT_CLIENT_ID",
  clientSecretEnv: "FITBIT_CLIENT_SECRET",
  authorizeUrl: "https://www.fitbit.com/oauth2/authorize",
  tokenUrl: "https://api.fitbit.com/oauth2/token",
  // SEVEN SCOPES, EVERY ONE OF THEM READ. Fitbit was down to three because the
  // other three it used to ask for were dead. It is back up to seven because
  // the adapter now calls the collections that justify them, which is the right
  // order to do it in: the scope list follows the code, never the other way.
  //
  // Deliberately still absent: `weight` and `profile`. Nothing reads either.
  //
  // Timing matters here. Fitbit is the one provider not yet registered, so
  // changing this list is free today and costs a re-consent from every
  // connected member afterwards. Getting it right once is why the endpoints
  // below were written before the developer application was created.
  scopes: [
    "activity",
    "heartrate",
    "sleep",
    "oxygen_saturation",
    "cardio_fitness",
    "respiratory_rate",
    "temperature",
  ],
  // Fitbit rejects credentials in the body and requires Basic.
  tokenAuth: "basic",
  refreshRotates: true,
  syncWindowDays: 7,
  async fetchRange({ accessToken, start, end }) {
    const out: DailyMetric[] = [];
    const api = "https://api.fitbit.com/1";

    const steps = await providerFetch<{ "activities-steps"?: { dateTime: string; value: string }[] }>(
      "fitbit",
      `${api}/user/-/activities/steps/date/${start}/${end}.json`,
      { accessToken },
    );
    for (const d of steps["activities-steps"] ?? []) {
      push(out, "steps", d.dateTime, num(d.value), "fitbit");
    }

    const rhr = await providerFetch<{
      "activities-heart"?: { dateTime: string; value?: { restingHeartRate?: number } }[];
    }>("fitbit", `${api}/user/-/activities/heart/date/${start}/${end}.json`, { accessToken });
    for (const d of rhr["activities-heart"] ?? []) {
      push(out, "resting_heart_rate", d.dateTime, num(d.value?.restingHeartRate), "fitbit");
    }

    // `${api}.2` is api.fitbit.com/1.2: sleep is the one collection still on
    // 1.2 while everything else here is on 1.
    const sleep = await providerFetch<{
      sleep?: {
        dateOfSleep?: string;
        minutesAsleep?: number;
        efficiency?: number;
        /** False for naps. Fitbit logs those as separate records. */
        isMainSleep?: boolean;
      }[];
    }>("fitbit", `${api}.2/user/-/sleep/date/${start}/${end}.json`, { accessToken });
    for (const s of sleep.sleep ?? []) {
      if (!s || typeof s !== "object") continue;
      // NAPS SHARE A DATE WITH THE NIGHT. The metrics upsert is keyed on
      // (user, provider, date, metric), so an afternoon nap arriving after the
      // night would replace it outright and the day would read as 40 minutes
      // of sleep. Same trap as Whoop's `nap` flag.
      if (s.isMainSleep === false) continue;
      push(out, "sleep_minutes", s.dateOfSleep, num(s.minutesAsleep), "fitbit");

      // NO SLEEP SCORE FROM FITBIT, deliberately. `efficiency` is time asleep
      // over time in bed, which is a different quantity from a sleep score:
      // Fitbit's own Sleep Score is a composite and is not exposed on the
      // public API at all. Publishing efficiency under `sleep_score` would put
      // a number next to Oura's that means something else, that the member
      // cannot reconcile against Fitbit's own app, and that is not even
      // labelled the same thing there. Better to contribute nothing.
    }

    /*
     * THE OVERNIGHT FOUR.
     *
     * HRV, SpO2, breathing rate and skin temperature all describe a user's
     * "main sleep", and Fitbit says plainly that a value dated the 22nd may
     * come from a night that began on the 21st. They have already decided which
     * day it belongs to, so `dateTime` is used as given rather than shifted.
     *
     * Each is its own collection behind its own scope, which is why Fitbit
     * contributed three metrics before this and eight after. All four cap at a
     * 30 day range; our window is 7.
     */
    const optional = async <T>(path: string): Promise<T | null> => {
      try {
        return await providerFetch<T>("fitbit", `${api}/user/-/${path}`, { accessToken });
      } catch {
        // A member can decline any one of these scopes at the consent screen.
        // Letting that fail the whole sync would cost them sleep and steps over
        // a metric they chose not to share, and a 403 here reaches the sweep as
        // ReauthRequired, which would mark the connection dead outright.
        return null;
      }
    };

    const [hrv, spo2, breathing, temp] = await Promise.all([
      optional<{ hrv?: { dateTime?: string; value?: { dailyRmssd?: number } }[] }>(
        `hrv/date/${start}/${end}.json`,
      ),
      optional<{ spo2?: { dateTime?: string; value?: { avg?: number } }[] }>(
        `spo2/date/${start}/${end}.json`,
      ),
      optional<{ br?: { dateTime?: string; value?: { breathingRate?: number } }[] }>(
        `br/date/${start}/${end}.json`,
      ),
      optional<{ tempSkin?: { dateTime?: string; value?: { nightlyRelative?: number } }[] }>(
        `temp/skin/date/${start}/${end}.json`,
      ),
    ]);

    for (const d of hrv?.hrv ?? []) {
      // `dailyRmssd` is the whole-night figure. `deepRmssd` covers deep sleep
      // only and is not what other vendors report, so it is not used.
      push(out, "hrv", d.dateTime, num(d.value?.dailyRmssd), "fitbit");
    }
    for (const d of spo2?.spo2 ?? []) {
      push(out, "spo2", d.dateTime, num(d.value?.avg), "fitbit");
    }
    for (const d of breathing?.br ?? []) {
      push(out, "respiratory_rate", d.dateTime, num(d.value?.breathingRate), "fitbit");
    }
    for (const d of temp?.tempSkin ?? []) {
      // `nightlyRelative` is already a deviation from the wearer's baseline,
      // signed and legitimately negative, which is exactly what our
      // `temperature_deviation` means. Unlike Whoop's skin_temp_celsius, this
      // one maps directly.
      push(out, "temperature_deviation", d.dateTime, num(d.value?.nightlyRelative), "fitbit");
    }

    const cardio = await optional<{
      cardioScore?: { dateTime?: string; value?: { vo2Max?: string } }[];
    }>(`cardioscore/date/${start}/${end}.json`);
    for (const d of cardio?.cardioScore ?? []) {
      push(out, "vo2max", d.dateTime, fitbitVo2Max(d.value?.vo2Max), "fitbit");
    }

    return out;
  },

  /**
   * Fitbit workouts, from the activity log list.
   *
   * THREE THINGS ABOUT THIS ENDPOINT ARE NOT LIKE THE OTHERS.
   *
   * It has no end date. `afterDate` must be paired with `sort=asc`, `offset`
   * must be 0 and `limit` caps at 100, so the window's far edge is trimmed here
   * rather than asked for. With a 7 day sync window and a 100 row page, a
   * member would have to log fourteen sessions a day to overflow it.
   *
   * It gives a duration, not an end time. `duration` is elapsed milliseconds
   * INCLUDING pauses, which is the right one for a start-to-end pair: the row
   * says when the session happened, and Oura's and Whoop's spans include their
   * pauses too. `activeDuration` would make our interval disagree with the
   * clock.
   *
   * `source` is an object, where Oura sends a plain string.
   */
  async fetchWorkouts({ accessToken, start, end }) {
    const res = await providerFetch<{ activities?: FitbitActivity[] }>(
      "fitbit",
      "https://api.fitbit.com/1/user/-/activities/list.json" +
        `?afterDate=${start}&sort=asc&offset=0&limit=100`,
      { accessToken },
    );

    const out: WorkoutSession[] = [];
    for (const a of res.activities ?? []) {
      if (!a || typeof a !== "object") continue;
      const id = a.logId;
      if (id === undefined || id === null || !a.startTime) continue;

      const ms = num(a.duration);
      const startMs = Date.parse(a.startTime);
      if (ms === undefined || ms <= 0 || !Number.isFinite(startMs)) continue;

      // The local date, taken from the offset Fitbit already applied. Their
      // timestamp says which day the member thinks it was; converting to UTC
      // first would move an evening session in Asia onto the following day.
      const date = a.startTime.slice(0, 10);
      if (date < start || date > end) continue;

      out.push({
        autoDetected: FITBIT_AUTO_LOG_TYPES.has(a.logType ?? ""),
        externalId: String(id),
        startedAt: a.startTime,
        endedAt: new Date(startMs + ms).toISOString(),
        date,
        activity: a.activityName ?? undefined,
        calories: num(a.calories),
        distanceM: fitbitDistanceMetres(a.distance, a.distanceUnit),
        avgHeartRate: num(a.averageHeartRate),
        // How Fitbit came by the session, which is the closest thing they give
        // to Oura's intensity label and worth keeping: a member reading their
        // own history should be able to tell what the watch guessed from what
        // they started.
        source: a.source?.name ?? a.logType ?? undefined,
      });
    }
    return out;
  },

  /**
   * Fitbit's documented revoke: POST /oauth2/revoke, Basic auth with the app's
   * own credentials, and the token in a form body.
   *
   * THE REFRESH TOKEN IS SENT, NOT THE ACCESS TOKEN. Fitbit accept either, and
   * revoking the refresh token kills the whole grant rather than one hour of it.
   */
  async revoke({ accessToken, refreshToken, clientId, clientSecret }) {
    const res = await fetch("https://api.fitbit.com/oauth2/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({ token: refreshToken ?? accessToken }),
    });
    if (!res.ok) {
      throw new Error(`fitbit revoke ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
  blurb: "Recovery, strain and sleep performance from Whoop.",
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
  async fetchRange({ accessToken, start, end }) {
    const out: DailyMetric[] = [];
    // v2. Their v1 to v2 guide maps every path we use one for one, v1 webhooks
    // are already removed, and new features land on v2 first.
    const api = "https://api.prod.whoop.com/developer/v2";
    const range = `start=${start}T00:00:00.000Z&end=${end}T23:59:59.999Z`;

    // 25 is the documented maximum for these collections. A 7-day window is
    // well inside it, so `next_token` is not followed; widen `syncWindowDays`
    // and this needs pagination first.
    const sleep = await providerFetch<{ records?: WhoopSleep[] }>(
      "whoop",
      `${api}/activity/sleep?${range}&limit=25`,
      { accessToken },
    );
    for (const s of sleep.records ?? []) {
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

    const recovery = await providerFetch<{ records?: WhoopRecovery[] }>(
      "whoop",
      `${api}/recovery?${range}&limit=25`,
      { accessToken },
    );
    for (const r of recovery.records ?? []) {
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
    const res = await providerFetch<{ records?: WhoopWorkout[] }>(
      "whoop",
      `https://api.prod.whoop.com/developer/v2/activity/workout` +
        `?start=${start}T00:00:00.000Z&end=${end}T23:59:59.999Z&limit=25`,
      { accessToken },
    );
    const out: WorkoutSession[] = [];
    for (const w of res.records ?? []) {
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
  async revoke({ accessToken }) {
    const res = await fetch("https://api.prod.whoop.com/developer/v2/user/access", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
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
