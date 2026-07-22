// Daily check-in reminder sender (runs in GitHub Actions, Node).
//
// 1. Ask the app which subscriptions are due (users with no check-in today),
//    authenticating with the shared CRON_SECRET.
// 2. Web-push the reminder to each, using the VAPID keypair.
//
// The web-push crypto runs here in Node rather than on the Cloudflare Worker,
// which isn't a good fit for it. Failures on individual endpoints don't abort
// the run; expired subscriptions (404/410) are counted and logged.

import webpush from "web-push";

const {
  APP_URL = "https://app.ikigaro.com",
  CRON_SECRET,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:hello@ikigaro.com",
} = process.env;

if (!CRON_SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error(
    "Missing required env: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY",
  );
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const PAYLOAD = JSON.stringify({
  title: "Your daily check-in",
  body: "How was today? Energy, sleep, one training note.",
  url: "/",
  tag: "daily-checkin",
});

async function main() {
  const res = await fetch(`${APP_URL}/api/cron/due-reminders`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!res.ok) {
    console.error(`due-reminders failed: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const { subscriptions = [], date } = await res.json();
  console.log(`Due for ${date}: ${subscriptions.length} subscription(s).`);

  let sent = 0;
  let expired = 0;
  let failed = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        PAYLOAD,
      );
      sent++;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) expired++;
      else {
        failed++;
        console.error(`push failed (HTTP ${code ?? "?"})`);
      }
    }
  }
  console.log(`Reminders: ${sent} sent, ${expired} expired, ${failed} failed.`);
  // A few dead endpoints are normal; only hard-fail if everything errored.
  if (subscriptions.length > 0 && sent === 0 && failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Reminder run crashed:", err);
  process.exit(1);
});
