import "server-only";

import { providerFetch, num } from "./http";
import {
  clampScore,
  dayOf,
  secondsToMinutes,
  type DailyMetric,
  type MetricKey,
} from "./metrics";
import type { ProviderId, WearableProvider } from "./types";

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

interface OuraDoc {
  day?: string;
  score?: number;
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
  name: "Oura",
  blurb: "Sleep, readiness and HRV from your Oura ring.",
  clientIdEnv: "OURA_CLIENT_ID",
  clientSecretEnv: "OURA_CLIENT_SECRET",
  authorizeUrl: "https://cloud.ouraring.com/oauth/authorize",
  tokenUrl: "https://api.ouraring.com/oauth/token",
  scopes: ["daily", "heartrate", "personal"],
  tokenAuth: "body",
  refreshRotates: true,
  syncWindowDays: 7,
  async fetchRange({ accessToken, start, end }) {
    const out: DailyMetric[] = [];
    const base = "https://api.ouraring.com/v2/usercollection";
    const qs = `start_date=${start}&end_date=${end}`;

    const [sleep, readiness, activity] = await Promise.all([
      providerFetch<{ data?: OuraDoc[] }>("oura", `${base}/daily_sleep?${qs}`, { accessToken }),
      providerFetch<{ data?: OuraDoc[] }>("oura", `${base}/daily_readiness?${qs}`, { accessToken }),
      providerFetch<{ data?: OuraDoc[] }>("oura", `${base}/daily_activity?${qs}`, { accessToken }),
    ]);

    for (const d of sleep.data ?? []) push(out, "sleep_score", d.day, num(d.score), "oura");
    for (const d of readiness.data ?? []) {
      push(out, "readiness_score", d.day, num(d.score), "oura");
    }
    for (const d of activity.data ?? []) {
      push(out, "steps", d.day, num(d.steps), "oura");
      push(out, "active_calories", d.day, num(d.active_calories), "oura");
    }

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
      push(out, "spo2", day, num(d.spo2_percentage?.average), "oura");
    }
    return out;
  },
};

/* -------------------------------------------------------------------------- */
/* Fitbit                                                                      */
/* -------------------------------------------------------------------------- */

const fitbit: WearableProvider = {
  id: "fitbit",
  name: "Fitbit",
  blurb: "Steps, sleep and resting heart rate from Fitbit.",
  clientIdEnv: "FITBIT_CLIENT_ID",
  clientSecretEnv: "FITBIT_CLIENT_SECRET",
  authorizeUrl: "https://www.fitbit.com/oauth2/authorize",
  tokenUrl: "https://api.fitbit.com/oauth2/token",
  scopes: ["activity", "heartrate", "sleep", "oxygen_saturation", "weight", "profile"],
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

    const sleep = await providerFetch<{
      sleep?: { dateOfSleep?: string; minutesAsleep?: number; efficiency?: number }[];
    }>("fitbit", `${api}.2/user/-/sleep/date/${start}/${end}.json`, { accessToken });
    for (const s of sleep.sleep ?? []) {
      push(out, "sleep_minutes", s.dateOfSleep, num(s.minutesAsleep), "fitbit");
      // Fitbit has no "sleep score" in the public API; efficiency is the
      // closest 0-100 analogue and is labelled as such in the UI.
      const eff = num(s.efficiency);
      if (eff !== undefined) push(out, "sleep_score", s.dateOfSleep, clampScore(eff), "fitbit");
    }
    return out;
  },
};

/* -------------------------------------------------------------------------- */
/* Whoop                                                                       */
/* -------------------------------------------------------------------------- */

interface WhoopCycle {
  end?: string;
  score?: {
    strain?: number;
    average_heart_rate?: number;
    resting_heart_rate?: number;
    hrv_rmssd_milli?: number;
    sleep_performance_percentage?: number;
    recovery_score?: number;
    spo2_percentage?: number;
    respiratory_rate?: number;
  };
  stage_summary?: { total_in_bed_time_milli?: number; total_awake_time_milli?: number };
}

const whoop: WearableProvider = {
  id: "whoop",
  name: "Whoop",
  blurb: "Recovery, strain and sleep performance from Whoop.",
  clientIdEnv: "WHOOP_CLIENT_ID",
  clientSecretEnv: "WHOOP_CLIENT_SECRET",
  authorizeUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
  tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
  scopes: [
    "read:recovery",
    "read:sleep",
    "read:cycles",
    "read:profile",
    "offline",
  ],
  tokenAuth: "body",
  refreshRotates: true,
  syncWindowDays: 7,
  async fetchRange({ accessToken, start, end }) {
    const out: DailyMetric[] = [];
    const api = "https://api.prod.whoop.com/developer/v1";
    const range = `start=${start}T00:00:00.000Z&end=${end}T23:59:59.999Z`;

    const sleep = await providerFetch<{ records?: WhoopCycle[] }>(
      "whoop",
      `${api}/activity/sleep?${range}&limit=25`,
      { accessToken },
    );
    for (const s of sleep.records ?? []) {
      const day = s.end ? dayOf(s.end) : undefined;
      const inBed = num(s.stage_summary?.total_in_bed_time_milli);
      const awake = num(s.stage_summary?.total_awake_time_milli);
      if (inBed !== undefined) {
        // Whoop reports time in bed and awake; asleep is the difference. Using
        // in-bed directly would systematically overstate sleep against every
        // other provider in the same chart.
        const asleepMs = Math.max(0, inBed - (awake ?? 0));
        push(out, "sleep_minutes", day, Math.round(asleepMs / 60000), "whoop");
      }
      const perf = num(s.score?.sleep_performance_percentage);
      if (perf !== undefined) push(out, "sleep_score", day, clampScore(perf), "whoop");
      push(out, "respiratory_rate", day, num(s.score?.respiratory_rate), "whoop");
    }

    const recovery = await providerFetch<{ records?: (WhoopCycle & { created_at?: string })[] }>(
      "whoop",
      `${api}/recovery?${range}&limit=25`,
      { accessToken },
    );
    for (const r of recovery.records ?? []) {
      const day = r.created_at ? dayOf(r.created_at) : r.end ? dayOf(r.end) : undefined;
      const score = num(r.score?.recovery_score);
      // Whoop's recovery answers the same question as Oura's readiness, so it
      // normalizes onto the same key rather than inventing a second one.
      if (score !== undefined) push(out, "readiness_score", day, clampScore(score), "whoop");
      push(out, "hrv", day, num(r.score?.hrv_rmssd_milli), "whoop");
      push(out, "resting_heart_rate", day, num(r.score?.resting_heart_rate), "whoop");
      push(out, "spo2", day, num(r.score?.spo2_percentage), "whoop");
    }
    return out;
  },
};

/* -------------------------------------------------------------------------- */
/* Withings                                                                    */
/* -------------------------------------------------------------------------- */

const withings: WearableProvider = {
  id: "withings",
  name: "Withings",
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
  name: "Garmin",
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
  name: "Ultrahuman",
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

  // `ring_data` is the ring itself. `profile` is required by /user_info, which
  // is the ONLY way to learn the Ultrahuman user id, because unlike every other
  // vendor here their token response carries no user identifier at all.
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

    // One request per day. `date` is the only parameter this endpoint accepts:
    // there is no range form on the OAuth API. (The separate personal-token API
    // does accept start_epoch/end_epoch, but that is a different host, a
    // different auth header, and not what we ship.)
    for (const day of daysBetween(start, end)) {
      let res: UltrahumanMetricsResponse;
      try {
        res = await providerFetch<UltrahumanMetricsResponse>(
          "ultrahuman",
          `${api}/user_data/metrics?date=${day}`,
          { accessToken },
        );
      } catch {
        // One missing day must not abandon the rest of the window. A ring that
        // was off the charger for a night simply has nothing for that date.
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
  return Boolean(process.env[p.clientIdEnv] && process.env[p.clientSecretEnv]);
}

export function configuredProviders(): WearableProvider[] {
  return PROVIDER_IDS.map((id) => PROVIDERS[id]).filter(providerConfigured);
}
