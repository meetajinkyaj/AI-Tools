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
  /**
   * Why this integration is retired, or null. Present means the row exists
   * only so somebody already connected can leave: reconnecting is impossible,
   * so no Connect button is offered.
   */
  retired?: string | null;
}

interface Connection {
  id: string;
  provider: string;
  status: string;
  last_sync_at: string | null;
}

/** One metric family, and which device answers for it. */
interface Source {
  family: string;
  label: string;
  blurb: string;
  /** The member's explicit choice, or null for the default ranking. */
  preferred: string | null;
  /**
   * Connected devices that have actually reported in this family, best-ranked
   * first. Empty or one long means there is nothing to choose.
   */
  ranked: string[];
}

interface Payload {
  enabled: boolean;
  available: Available[];
  connections: Connection[];
  sources?: Source[];
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

/**
 * "Which device to believe", when more than one answers the same question.
 *
 * WHY THIS EXISTS. Two devices reporting the same night is a contradiction the
 * app has to resolve, and it resolves it with a ranking of ours that nobody can
 * see: a member reads 6h50m here and 7h12m in Whoop's own app and has no way to
 * tell a rule from a bug. Making the choice theirs turns an invisible decision
 * into a visible one, which is the only version of it that can be trusted.
 *
 * IT APPEARS ONLY WHEN THERE IS SOMETHING TO CHOOSE. One device answers
 * everything and there is no conflict to resolve, so the section states that in
 * one line and offers no controls. A family is listed only once two connected
 * devices have actually reported in it, so nobody is asked to pick a glucose
 * source for two devices that do not measure glucose.
 *
 * "AUTOMATIC" IS A REAL OPTION AND IT NAMES ITS OWN ANSWER. Presenting the
 * default as a nameless fallback would be the same opacity in a new place.
 *
 * A CHOICE IS A PROMOTION, NOT A LOCK, and the copy says so. The chosen device
 * goes first; a night it missed is still filled by the other one. Anybody who
 * read this as "only use my ring" would expect gaps, and would be wrong in the
 * direction that loses them data.
 */
function SourcePicker({
  payload,
  busy,
  onChoose,
}: {
  payload: Payload;
  busy: string | null;
  onChoose: (family: string, provider: string | null) => void;
}) {
  if (payload.connections.length === 0) return null;

  const choosable = (payload.sources ?? []).filter((s) => s.ranked.length > 1);

  if (choosable.length === 0) {
    // One device, or two that do not overlap. Said rather than left blank: a
    // member who has just read about the merge somewhere should be able to see
    // that it is not doing anything to them.
    const only = payload.connections.length === 1
      ? brandName(payload, payload.connections[0].provider)
      : null;
    return (
      <p className="border-t border-line pt-3 text-micro text-muted">
        {only
          ? `Every reading in Trends comes from your ${only}.`
          : "Your devices each answer for different readings, so there is nothing to choose between."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-col gap-1">
        <p className="font-label text-[0.55rem] uppercase tracking-[0.24em] text-muted">
          Which device to use
        </p>
        <p className="text-micro text-muted">
          More than one of your devices reports these. Your choice goes first; if it
          has nothing for a day, the other one still fills it in.
        </p>
      </div>

      {choosable.map((s) => {
        const working = busy === `source:${s.family}`;
        return (
          <div key={s.family} className="flex flex-col gap-1.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-body-sm text-ink">{s.label}</span>
              <span className="text-micro text-muted">{s.blurb}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip
                selected={s.preferred === null}
                disabled={busy !== null}
                onClick={() => onChoose(s.family, null)}
              >
                {/* The default names the device it currently resolves to, so
                    "Automatic" is a described behaviour rather than a shrug. */}
                Automatic ({brandName(payload, s.ranked[0])})
              </Chip>
              {s.ranked.map((id) => (
                <Chip
                  key={id}
                  selected={s.preferred === id}
                  disabled={busy !== null}
                  onClick={() => onChoose(s.family, id)}
                >
                  {brandName(payload, id)}
                </Chip>
              ))}
            </div>
            {working && (
              <span className="text-micro text-muted">Saving…</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Chip({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`iki-tap rounded-pill border px-3 py-1 text-micro transition-colors disabled:opacity-60 ${
        selected
          ? "border-primary text-primary"
          : "border-line text-ink/70 hover:border-primary hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
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

  /**
   * Choose the device for one family, or hand it back to the default.
   *
   * Reloads rather than patching state locally. The server owns which choices
   * are even offered (a device has to have reported in that family), and a
   * client that guessed at the new shape would be right until it was not.
   */
  const setSource = async (family: string, provider: string | null) => {
    setBusy(`source:${family}`);
    setMessage(null);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/wearables", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-source", family, provider }),
      });
      if (!res.ok) {
        setMessage("Couldn't save that choice. Please try again.");
        return;
      }
      await load();
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
            className="iki-tap text-micro text-primary underline underline-offset-2 disabled:text-muted disabled:no-underline"
          >
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
        )}
      </div>

      <p className="text-body-sm text-muted">
        {data.available.length > 0
          ? "Connect a ring, watch or scale and your sleep, recovery and activity flow into Trends automatically. You can disconnect at any time."
          : // Nothing is connectable yet, so promising a connect action here
            // would be a button that does not exist. Say what is coming instead.
            "Wearable device syncing is coming soon."}
      </p>

      {message && (
        <p role="status" className="text-body-sm text-ink">
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
              className="flex items-start justify-between gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-body-sm font-semibold text-ink">{p.name}</span>
                <span className="text-micro text-muted">{p.blurb}</span>
                {conn && !needsReauth && (
                  <span className="text-micro text-muted">
                    {whenSynced(conn.last_sync_at)}
                    {/* Garmin only sends data when the watch next syncs, which
                        otherwise looks like a broken connection for hours. */}
                    {p.pushOnly && !conn.last_sync_at && " · data arrives after your next watch sync"}
                  </span>
                )}
                {needsReauth && !p.retired && (
                  <span className="text-[0.7rem] text-primary">
                    Connection expired, reconnect to resume syncing.
                  </span>
                )}
                {p.retired && (
                  <span className="text-[0.7rem] text-primary">
                    No longer available. Your existing data stays in Trends, and
                    you can disconnect below.
                  </span>
                )}
              </div>

              {/* A retired provider always offers Disconnect and never Connect,
                  whatever the connection's status says. Reconnecting cannot
                  work, and offering it would send somebody to a consent screen
                  that fails. */}
              {conn && (p.retired || !needsReauth) ? (
                <button
                  type="button"
                  onClick={() => askDisconnect(p.id, p.name)}
                  disabled={busy !== null}
                  className={`${secondaryButtonClass} shrink-0 text-xs`}
                >
                  Disconnect
                </button>
              ) : p.retired ? null : (
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

      <SourcePicker
        payload={data}
        busy={busy}
        onChoose={(family, provider) => void setSource(family, provider)}
      />

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <p className="font-label text-[0.55rem] uppercase tracking-[0.24em] text-muted">
          Coming soon
        </p>
        {COMING_SOON.map((c) => (
          <div key={c.name} className="flex flex-col gap-0.5">
            <span className="text-body-sm text-muted">{c.name}</span>
            <span className="text-micro text-muted/70">{c.blurb}</span>
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
