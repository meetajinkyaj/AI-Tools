"use client";

import { useCallback, useEffect, useState } from "react";

import { DeviceSuggest } from "./device-suggest";
import { Card, Eyebrow, primaryButtonClass, secondaryButtonClass } from "./ui";

/**
 * "Connected devices" in Settings.
 *
 * Hidden entirely when the server says the feature is off — either no
 * encryption key, or no vendor credentials configured. Showing six greyed-out
 * cards for devices nobody can connect is worse than showing nothing.
 */

interface Available {
  id: string;
  name: string;
  blurb: string;
  /** Garmin. Data arrives when the watch next syncs, not on connect. */
  pushOnly: boolean;
}

interface Connection {
  id: string;
  provider: string;
  status: string;
  last_sync_at: string | null;
}

interface Payload {
  enabled: boolean;
  available: Available[];
  connections: Connection[];
}

/**
 * The two we cannot do yet, shown so the roadmap is visible.
 *
 * Apple HealthKit and Android Health Connect are on-device APIs with no web
 * access of any kind — reading either requires a native app in the respective
 * store. Listing them as "coming soon" is honest about a real plan rather than
 * a placeholder, and it stops the obvious question ("where's Apple Health?")
 * reading as an omission.
 *
 * Rendered as plain rows, deliberately NOT as disabled buttons. A greyed-out
 * button invites tapping, and a button that does nothing when tapped reads as
 * broken rather than as unreleased.
 *
 * No "needs our iOS app" caveat. Why a thing is not ready yet is our problem,
 * not something a user should have to read on the way past.
 */
const COMING_SOON = [
  { name: "Apple Health", blurb: "Sleep, steps and workouts from iPhone and Apple Watch." },
  { name: "Google Health Connect", blurb: "Sleep, steps and heart rate from Android." },
];

function whenSynced(iso: string | null): string {
  if (!iso) return "not synced yet";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 2) return "synced just now";
  if (mins < 60) return `synced ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `synced ${hrs}h ago`;
  return `synced ${Math.round(hrs / 24)}d ago`;
}

export function WearableSettings({
  getToken,
}: {
  getToken: () => Promise<string | null>;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Read the OAuth result off the URL and clear it.
   *
   * The vendor redirects back to "/?wearable=connected&provider=oura". This
   * runs inside the async load rather than its own effect for two reasons: a
   * synchronous setState in an effect triggers a cascading render (and the lint
   * rule that catches it), and computing it during render instead would
   * mismatch hydration, because the server has no URL params to read.
   */
  const consumeOAuthResult = (): string | null => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("wearable");
    if (!result) return null;
    const provider = params.get("provider") ?? "device";

    params.delete("wearable");
    params.delete("provider");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));

    return result === "connected"
      ? `${provider} connected.`
      : `Couldn't connect ${provider}. Please try again.`;
  };

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/wearables", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setData((await res.json()) as Payload);
    } catch {
      /* the rest of Settings still works */
    }
  }, [getToken]);

  useEffect(() => {
    void (async () => {
      const result = consumeOAuthResult();
      await load();
      if (result) setMessage(result);
    })();
  }, [load]);

  // Renders as soon as the server answers, even with no providers configured —
  // otherwise the "coming soon" roadmap stays hidden until the first vendor
  // approval lands, which is exactly the stretch when saying what is coming is
  // most useful.
  if (!data) return null;

  const connectedBy = new Map(data.connections.map((c) => [c.provider, c]));

  const connect = async (provider: string) => {
    setBusy(provider);
    setMessage(null);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`/api/wearables/connect?provider=${provider}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setMessage(body.error ?? "Couldn't start the connection.");
        return;
      }
      // Full navigation, not a popup: consent pages routinely refuse to render
      // in one, and a blocked popup looks to the user like a broken button.
      window.location.href = body.url;
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (provider: string) => {
    setBusy(provider);
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`/api/wearables?provider=${provider}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await load();
      setMessage(`${provider} disconnected.`);
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    setBusy("sync");
    setMessage(null);
    try {
      const token = await getToken();
      if (!token) return;
      await fetch("/api/wearables", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      await load();
      setMessage("Synced.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Connected devices</Eyebrow>
        {data.connections.length > 0 && (
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={busy !== null}
            className="font-body text-xs text-accent underline underline-offset-2 disabled:text-muted disabled:no-underline"
          >
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
        )}
      </div>

      <p className="font-body text-sm text-muted">
        {data.available.length > 0
          ? "Connect a ring, watch or scale and your sleep, recovery and activity flow into Trends automatically. You can disconnect at any time."
          : // Nothing is connectable yet, so promising a connect action here
            // would be a button that does not exist. Say what is coming instead.
            "Wearable device syncing is coming soon."}
      </p>

      {message && (
        <p role="status" className="font-body text-sm text-foreground">
          {message}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {data.available.map((p) => {
          const conn = connectedBy.get(p.id);
          const needsReauth = conn?.status === "expired";
          return (
            <li
              key={p.id}
              className="flex items-start justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-body text-sm font-medium text-foreground">{p.name}</span>
                <span className="font-body text-xs text-muted">{p.blurb}</span>
                {conn && !needsReauth && (
                  <span className="font-body text-[0.7rem] text-muted">
                    {whenSynced(conn.last_sync_at)}
                    {/* Garmin only sends data when the watch next syncs, which
                        otherwise looks like a broken connection for hours. */}
                    {p.pushOnly && !conn.last_sync_at && " · data arrives after your next watch sync"}
                  </span>
                )}
                {needsReauth && (
                  <span className="font-body text-[0.7rem] text-accent">
                    Connection expired — reconnect to resume syncing.
                  </span>
                )}
              </div>

              {conn && !needsReauth ? (
                <button
                  type="button"
                  onClick={() => void disconnect(p.id)}
                  disabled={busy !== null}
                  className={`${secondaryButtonClass} shrink-0 text-xs`}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void connect(p.id)}
                  disabled={busy !== null}
                  className={`${primaryButtonClass} shrink-0 text-xs`}
                >
                  {busy === p.id ? "…" : needsReauth ? "Reconnect" : "Connect"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="font-label text-[0.55rem] uppercase tracking-[0.24em] text-muted">
          Coming soon
        </p>
        {COMING_SOON.map((c) => (
          <div key={c.name} className="flex flex-col gap-0.5">
            <span className="font-body text-sm text-muted">{c.name}</span>
            <span className="font-body text-xs text-muted/70">{c.blurb}</span>
          </div>
        ))}
      </div>

      <DeviceSuggest getToken={getToken} />
    </Card>
  );
}
