"use client";

import { VAPID_PUBLIC_KEY } from "@/lib/vapid-public-key";

/** Push notification support / subscription state for the settings toggle. */
export type PushState =
  | "unsupported" // no service worker / PushManager
  | "denied" // the user blocked notifications in the browser
  | "off" // supported, not subscribed
  | "on"; // subscribed

/** applicationServerKey must be a Uint8Array; VAPID keys are base64url strings.
 * Backed by an explicit ArrayBuffer so it satisfies BufferSource under TS 5.7. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Current state, without prompting for permission. */
export async function getPushState(): Promise<PushState> {
  if (!isSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/**
 * Request permission (if needed), subscribe via the browser push service, and
 * persist the subscription server-side. Returns the resulting state.
 */
export async function enablePush(
  getToken: () => Promise<string | null>,
): Promise<PushState> {
  if (!isSupported()) return "unsupported";

  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  const token = await getToken();
  if (!token) return "off";

  const json = sub.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  if (!res.ok) {
    // Roll back the browser subscription so state stays consistent.
    await sub.unsubscribe().catch(() => {});
    return "off";
  }
  return "on";
}

/** Unsubscribe locally and remove the subscription server-side. */
export async function disablePush(
  getToken: () => Promise<string | null>,
): Promise<PushState> {
  if (!isSupported()) return "unsupported";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const { endpoint } = sub.toJSON();
    await sub.unsubscribe().catch(() => {});
    const token = await getToken();
    if (token && endpoint) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      }).catch(() => {});
    }
  }
  return "off";
}
