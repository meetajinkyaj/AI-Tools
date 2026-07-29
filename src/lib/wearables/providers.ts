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
 * vendor's JSON into `DailyMetric[]`. All the machinery around them — refresh,
 * rotation, backoff, upsert — is in `sync.ts` and shared.
 *
 * NONE OF THESE WORK WITHOUT CREDENTIALS. Every vendor requires registering a
 * developer application to get a client id and secret; two of them (Garmin,
 * Ultrahuman) require an approved application on top, with a lead time of
 * weeks. A provider whose env vars are unset is simply hidden from the UI, so
 * this file being complete does not mean the feature is live — see
 * `docs/WEARABLES.md`.
 *
 * ENDPOINTS DRIFT. These are written against each vendor's documented v1/v2
 * APIs as of mid-2026. The normalizers are defensive — an unexpected shape
 * yields fewer metrics, never a crash — but if a provider suddenly returns
 * nothing, check their changelog before debugging this file.
 */

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
      // closest 0–100 analogue and is labelled as such in the UI.
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
/* Garmin — push only                                                          */
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
   * all — it pushes to a registered webhook when data lands, and there is no
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
  authorizeUrl: "https://partner.ultrahuman.com/oauth/authorize",
  tokenUrl: "https://partner.ultrahuman.com/oauth/token",
  scopes: ["read:metrics", "read:sleep"],
  tokenAuth: "body",
  // Documented explicitly by Ultrahuman: each refresh returns a NEW refresh
  // token and retires the old one. Miss the write-back and the connection
  // survives exactly one more refresh before dying silently.
  refreshRotates: true,
  syncWindowDays: 7,
  requiresApproval: true,
  async fetchRange({ accessToken, start, end }) {
    const out: DailyMetric[] = [];
    const api = "https://partner.ultrahuman.com/api/v1";

    const res = await providerFetch<{
      data?: {
        date?: string;
        sleep?: { total_sleep_minutes?: number; sleep_index?: number };
        recovery?: { score?: number; hrv?: number; resting_heart_rate?: number };
        activity?: { steps?: number; active_calories?: number };
        temperature?: { deviation_c?: number };
      }[];
    }>("ultrahuman", `${api}/metrics?start_date=${start}&end_date=${end}`, { accessToken });

    for (const d of res.data ?? []) {
      const day = d.date;
      push(out, "sleep_minutes", day, num(d.sleep?.total_sleep_minutes), "ultrahuman");
      const idx = num(d.sleep?.sleep_index);
      if (idx !== undefined) push(out, "sleep_score", day, clampScore(idx), "ultrahuman");
      const rec = num(d.recovery?.score);
      if (rec !== undefined) push(out, "readiness_score", day, clampScore(rec), "ultrahuman");
      push(out, "hrv", day, num(d.recovery?.hrv), "ultrahuman");
      push(out, "resting_heart_rate", day, num(d.recovery?.resting_heart_rate), "ultrahuman");
      push(out, "steps", day, num(d.activity?.steps), "ultrahuman");
      push(out, "active_calories", day, num(d.activity?.active_calories), "ultrahuman");
      push(out, "temperature_deviation", day, num(d.temperature?.deviation_c), "ultrahuman");
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
 * surface — as a vendor error page with our name on it.
 */
export function providerConfigured(p: WearableProvider): boolean {
  return Boolean(process.env[p.clientIdEnv] && process.env[p.clientSecretEnv]);
}

export function configuredProviders(): WearableProvider[] {
  return PROVIDER_IDS.map((id) => PROVIDERS[id]).filter(providerConfigured);
}
