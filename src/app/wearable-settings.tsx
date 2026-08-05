"use client";

import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { DeviceSuggest } from "./device-suggest";
import { Card, Eyebrow, primaryButtonClass, secondaryButtonClass } from "./ui";

/**
 * "Connected devices" in Settings.
 *
 * Hidden entirely when the server says the feature is off, either no
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
 * access of any kind, reading either requires a native app in the respective
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

/**
 * The vendor's display name, never its lowercase id.
 *
 * Provider ids are lowercase because they travel in URLs. "ultrahuman" in a
 * sentence reads as a typo, and the server already sends the proper name for
 * every configured provider, so there is no reason to guess at capitalisation.
 */
function brandName(payload: Payload | null, providerId: string): string {
  return payload?.available.find((p) => p.id === providerId)?.name ?? "your device";
}

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
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  /**
   * Read the OAuth result off the URL and clear it.
   *
   * The vendor redirects back to "/?wearable=connected&provider=oura". This
   * runs inside the async load rather than its own effect for two reasons: a
   * synchronous setState in an effect triggers a cascading render (and the lint
   * rule that catches it), and computing it during render instead would
   * mismatch hydration, because the server has no URL params to read.
   */
  const consumeOAuthResult = (): { result: string; provider: string } | null => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("wearable");
    if (!result) return null;
    const provider = params.get("provider") ?? "";

    params.delete("wearable");
    params.delete("provider");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));

    return { result, provider };
  };

  const load = useCallback(async (): Promise<Payload | null> => {
    try {
      const token = await getToken();
      if (!token) return null;
      const res = await fetch("/api/wearables", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as Payload;
      setData(payload);
      return payload;
    } catch {
      /* the rest of Settings still works */
      return null;
    }
  }, [getToken]);

  useEffect(() => {
    void (async () => {
      const outcome = consumeOAuthResult();
      const payload = await load();

      // SUCCESS SAYS NOTHING. The row two lines below already reads "Ultrahuman
      // ... Disconnect ... synced just now", so a banner announcing the same
      // thing is noise sitting above the evidence for it.
      //
      // FAILURE STILL SPEAKS, because there is nothing else to see: the row
      // looks exactly as it did before the attempt, and silence there reads as
      // the button not working.
      if (outcome && outcome.result !== "connected") {
        setMessage(`Couldn't connect ${brandName(payload, outcome.provider)}. Please try again.`);
      }
    })();
  }, [load]);

  // Renders as soon as the server answers, even with no providers configured, // otherwise the "coming soon" roadmap stays hidden until the first vendor
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

  const disconnect = async (provider: string, name: string) => {
    setBusy(provider);
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`/api/wearables?provider=${provider}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await load();
      setConfirm(null);
      // Unlike connecting, this one IS worth saying. The row it refers to has
      // just changed from Disconnect to Connect, and confirming that the
      // permission was deleted is the reassurance the action was for.
      setMessage(`${name} disconnected.`);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Disconnecting is one tap next to a row of other taps, and it is not
   * undoable by tapping again: reconnecting means another round trip through
   * the vendor's consent screen. The dialog is here for the fat finger, and it
   * says what actually happens, which is that the authorisation is deleted and
   * the readings already pulled are kept.
   *
   * "APPROVING ACCESS AGAIN", NOT "SIGNING IN AGAIN". An earlier version
   * promised a sign-in, and a real reconnect went straight to the consent
   * screen with no credentials asked for. That is correct OAuth, not a bug:
   * disconnecting deletes OUR copy of the permission and touches neither the
   * user's session at the vendor nor the grant recorded in their vendor
   * account. A sign-in only appears when that session has lapsed, so promising
   * one is wrong more often than it is right.
   */
  const askDisconnect = (provider: string, name: string) => {
    setMessage(null);
    setConfirm({
      title: `Disconnect ${name}?`,
      body:
        `We'll stop pulling new data from ${name} and delete the permission it ` +
        "gave us. Readings already synced stay in your Trends. You can " +
        `reconnect any time by approving access at ${name} again.`,
      confirmLabel: "Disconnect",
      onConfirm: () => void disconnect(provider, name),
    });
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
                    Connection expired, reconnect to resume syncing.
                  </span>
                )}
              </div>

              {conn && !needsReauth ? (
                <button
                  type="button"
                  onClick={() => askDisconnect(p.id, p.name)}
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

      {confirm && (
        <ConfirmDialog
          request={confirm}
          busy={busy !== null}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Card>
  );
}
