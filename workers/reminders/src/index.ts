/**
 * Reminder sender — a Cloudflare Worker on a cron trigger.
 *
 * Replaces the GitHub Actions schedule, which was firing 90–110 minutes late,
 * every day, consistently. A "6 PM daily nudge" arriving at 7:40 PM undermines
 * the exact habit it exists to build, and GitHub documents scheduled runs as
 * best-effort under load. Cloudflare cron triggers fire on time.
 *
 * The app still owns all the decisions: this Worker asks
 * `/api/cron/due-reminders` who is due and what to say, then sends. Payload
 * copy and point values stay in the app so there is one source of truth.
 *
 * Sends remain at-most-once: the app marks people as notified *before*
 * returning them, so a retry, a manual run, or an overlapping GitHub fallback
 * can never double-notify anyone.
 */

import { sendPush, type PushSubscription } from "../../../src/lib/web-push";

/**
 * The two Workers runtime types this file needs, declared locally rather than
 * pulling in `@cloudflare/workers-types` — that package redefines `fetch`,
 * `Request` and friends, which collides with the DOM lib the Next app is
 * typechecked against. Two interfaces are cheaper than that fight.
 */
interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface Env {
  APP_URL: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  /* secrets */
  CRON_SECRET: string;
  VAPID_PRIVATE_KEY: string;
}

interface DueResponse {
  date: string;
  subscriptions?: PushSubscription[];
  retest?: { subscriptions?: PushSubscription[]; payload?: unknown } | null;
}

const DAILY_PAYLOAD = JSON.stringify({
  title: "Your daily check-in",
  body: "How was today? Energy, sleep, one training note.",
  url: "/",
  tag: "daily-checkin",
});

interface Tally {
  sent: number;
  expired: number;
  failed: number;
}

async function pushAll(
  subscriptions: PushSubscription[],
  payload: string,
  env: Env,
): Promise<Tally> {
  const vapid = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || "mailto:hello@ikigaro.com",
  };

  const tally: Tally = { sent: 0, expired: 0, failed: 0 };
  // Sequential on purpose: batches are small (beta scale) and this keeps us
  // well clear of any push-service rate limiting.
  for (const subscription of subscriptions) {
    const result = await sendPush({ subscription, payload, vapid });
    if (result.ok) tally.sent++;
    else if (result.expired) tally.expired++;
    else {
      tally.failed++;
      console.error(`push failed (HTTP ${result.status})`);
    }
  }
  return tally;
}

async function runReminders(env: Env): Promise<string> {
  if (!env.CRON_SECRET || !env.VAPID_PRIVATE_KEY) {
    throw new Error("Missing CRON_SECRET or VAPID_PRIVATE_KEY (set with wrangler secret put)");
  }

  const appUrl = env.APP_URL || "https://app.ikigaro.com";
  const res = await fetch(`${appUrl}/api/cron/due-reminders`, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  if (!res.ok) {
    throw new Error(`due-reminders failed: HTTP ${res.status} ${await res.text()}`);
  }

  const { subscriptions = [], retest = null, date } = (await res.json()) as DueResponse;
  const retestSubs = retest?.subscriptions ?? [];

  const daily = await pushAll(subscriptions, DAILY_PAYLOAD, env);
  // The panel-day payload is built by the server, so POINTS stays authoritative.
  const retestTally = retestSubs.length
    ? await pushAll(retestSubs, JSON.stringify(retest?.payload ?? {}), env)
    : { sent: 0, expired: 0, failed: 0 };

  const summary =
    `${date}: ${subscriptions.length} check-in nudge(s), ${retestSubs.length} re-test push(es) — ` +
    `sent ${daily.sent + retestTally.sent}, ` +
    `expired ${daily.expired + retestTally.expired}, ` +
    `failed ${daily.failed + retestTally.failed}`;
  console.log(summary);
  return summary;
}

/**
 * Nightly wearable sync.
 *
 * Rides on this Worker rather than getting its own because it needs exactly
 * what this one already has: a Cloudflare cron trigger that fires on time and
 * the CRON_SECRET to call the app with. The app does all the work; this only
 * pulls the trigger.
 *
 * Runs on its own schedule, early morning IST, so a night's sleep has been
 * finalised by the vendors before we ask for it.
 */
async function runWearableSync(env: Env): Promise<string> {
  const res = await fetch(`${env.APP_URL}/api/cron/sync-wearables`, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  if (!res.ok) {
    throw new Error(`sync-wearables failed: HTTP ${res.status} ${await res.text()}`);
  }
  const summary = await res.text();
  console.log(`wearable sync: ${summary}`);
  return summary;
}

/** Which job a firing is for. Both are declared in wrangler.toml. */
const WEARABLE_CRON = "0 2 * * *";

const handler = {
  /**
   * Cron trigger — the primary path.
   *
   * Two schedules share this Worker, so the handler branches on which one
   * fired. Defaulting to reminders (rather than to the sync) is deliberate: if
   * a schedule is ever edited to a value this code does not recognise, the
   * failure mode should be "the nudge still goes out", not "everything silently
   * becomes a database sweep".
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const job = event.cron === WEARABLE_CRON ? runWearableSync : runReminders;
    const label = event.cron === WEARABLE_CRON ? "wearable sync" : "reminder";
    ctx.waitUntil(
      job(env).catch((err) => {
        // Logged to Workers observability; the run is visibly a failure.
        console.error(`${label} run failed:`, err instanceof Error ? err.message : err);
        throw err;
      }),
    );
  },

  /**
   * Manual trigger, so the pipeline can be exercised without waiting for 6 PM.
   * Requires the same CRON_SECRET — this Worker sends real notifications to
   * real people, so it is never open.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!env.CRON_SECRET || token !== env.CRON_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      return new Response(await runReminders(env), { status: 200 });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "failed", { status: 500 });
    }
  },
};

export default handler;
