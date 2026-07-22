/**
 * The public VAPID key (a.k.a. applicationServerKey) for Web Push.
 *
 * This is PUBLIC by design — the browser needs it to create a push subscription,
 * so it ships in the client bundle. It is safe to commit. The matching PRIVATE
 * key is a secret and lives ONLY in the reminder sender's environment (a GitHub
 * Actions secret), never here and never in the Worker.
 *
 * Hardcoded (overridable via env) for the same reason as the Supabase URL: a
 * NEXT_PUBLIC_* var is inlined at BUILD time, and on Cloudflare runtime-only vars
 * inline as `undefined`. Replace the placeholder with the real public key from
 * `npx web-push generate-vapid-keys` before enabling reminders.
 */
export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BO0_4R3vGWEJE8aBprqv7itcTFbC-SlJp5nlRxE5iyPoHrNPefYHrFkMReEV5maL2QIh2VuXlfy1OraFTVzuTnU";

/** True once a real key has been configured (the toggle stays hidden otherwise). */
export const PUSH_ENABLED = VAPID_PUBLIC_KEY !== "REPLACE_WITH_VAPID_PUBLIC_KEY";
