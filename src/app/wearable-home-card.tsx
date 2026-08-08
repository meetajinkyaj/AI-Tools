"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, Eyebrow, secondaryButtonClass } from "./ui";

/**
 * The Home entry point for device syncing.
 *
 * TWO STATES, AND THEY ARE DIFFERENT JOBS.
 *
 * NOTHING CONNECTED: the pitch. Connecting a device is a thing you do once, and
 * nobody browses Settings looking for a feature they do not yet know exists, so
 * discovery has to live where people already are, which is Home. It is
 * dismissable, because a pitch you have decided against should go away.
 *
 * SOMETHING CONNECTED: the sync control. This is here because the app's own
 * schedule is invisible: data appears overnight, and somebody who has just
 * finished a session has no way to tell "not synced yet" apart from "broken".
 * One button and one line of status answers both. It is NOT dismissable, since
 * it is a control rather than an advertisement.
 *
 * The full provider list is not duplicated in either state. Managing
 * connections (which are on, disconnecting one) stays in Settings, and two
 * copies of that list is two things to keep in step.
 */

const DISMISS_KEY = "ikigaro:wearable-card-dismissed";

interface Payload {
  enabled: boolean;
  available: { id: string; name: string }[];
  connections: { provider: string; status: string; last_sync_at?: string | null }[];
}

/** The same wording Settings uses, so two screens never disagree about a time. */
function whenSynced(iso: string | null | undefined): string {
  if (!iso) return "not synced yet";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 2) return "synced just now";
  if (mins < 60) return `synced ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `synced ${hrs}h ago`;
  return `synced ${Math.round(hrs / 24)}d ago`;
}

/**
 * What "Sync now" actually does, in the words of somebody who does not know
 * what an API is.
 *
 * WHY IT IS A POPUP AND NOT A CAPTION. All four of these facts matter and none
 * of them matter often. Printed under the button they would be four lines of
 * explanation attached to a control that takes one tap; behind an icon they are
 * there for the one time somebody wonders whether the thing is working.
 *
 * THE SCHEDULE IS NAMED, WITH ITS REAL TIME. "Syncs automatically" invites the
 * question this dialog exists to answer. The Worker's cron is 02:00 UTC, which
 * is 07:30 in India, where the beta is.
 */
function SyncInfoDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
      <Card className="flex w-full max-w-sm flex-col gap-4 p-6">
        <div className="flex flex-col gap-2">
          <Eyebrow>About syncing</Eyebrow>
          <p className="font-display text-xl font-medium text-foreground">
            You do not have to press this
          </p>
          <p className="font-body text-sm text-muted">
            Ikigaro pulls your last 7 days from your device every morning at 7:30 AM
            IST, and again the moment you connect a new device. Everything it finds
            goes straight into Trends.
          </p>
          <p className="font-body text-sm text-muted">
            Syncing now asks your device maker for that data straight away. It is
            useful right after a workout, when you would rather not wait until
            tomorrow to see it.
          </p>
          <p className="font-body text-sm text-muted">
            Some readings take time to appear at their end. A night&apos;s sleep is
            usually finalised a few hours after you wake, so an early sync can come
            back with nothing new and nothing wrong.
          </p>
        </div>
        <button type="button" onClick={onClose} className={`${secondaryButtonClass} w-full`}>
          Got it
        </button>
      </Card>
    </div>
  );
}

export function WearableHomeCard({
  getToken,
  onOpenSettings,
}: {
  getToken: () => Promise<string | null>;
  onOpenSettings: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [info, setInfo] = useState(false);

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
      /* Home must render with or without this */
    }
  }, [getToken]);

  useEffect(() => {
    // Read the dismissal inside the effect rather than during render: the
    // server has no localStorage, so doing it at render time would produce
    // markup that disagrees with the client and break hydration.
    void (async () => {
      const wasDismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
      await load();
      if (wasDismissed) setDismissed(true);
    })();
  }, [load]);

  if (!data) return null;

  const connections = data.connections ?? [];

  /* ------------------------------ connected ------------------------------- */

  if (connections.length > 0) {
    // Named when there is one, because "Sync with Whoop" tells somebody which
    // device this button is about and "Sync your devices" does not. Once there
    // are two, naming one of them would be wrong rather than merely vague.
    const brand =
      connections.length === 1
        ? (data.available.find((p) => p.id === connections[0].provider)?.name ?? "your device")
        : null;

    // The most recent sync across every connection, since the button syncs all
    // of them and a per-device breakdown belongs in Settings.
    const lastSync = connections
      .map((c) => c.last_sync_at)
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .sort()
      .pop();

    const syncNow = async () => {
      setSyncing(true);
      try {
        const token = await getToken();
        if (!token) return;
        await fetch("/api/wearables", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync" }),
        });
        // Re-read rather than assuming it worked. The timestamp below is the
        // honest report of what happened, and it comes from the server.
        await load();
      } finally {
        setSyncing(false);
      }
    };

    return (
      <>
        <Card className="flex items-center justify-between gap-3 p-5">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <Eyebrow>Your devices</Eyebrow>
              <button
                type="button"
                onClick={() => setInfo(true)}
                aria-label="How syncing works"
                className="flex h-4 w-4 items-center justify-center rounded-full border border-border font-body text-[0.6rem] leading-none text-muted transition-colors hover:border-accent hover:text-accent"
              >
                i
              </button>
            </div>
            <p className="font-body text-xs text-muted">{whenSynced(lastSync)}</p>
          </div>

          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={syncing}
            className={`${secondaryButtonClass} shrink-0 text-xs disabled:opacity-60`}
          >
            {syncing ? "Syncing…" : brand ? `Sync with ${brand}` : "Sync your devices"}
          </button>
        </Card>

        {info && <SyncInfoDialog onClose={() => setInfo(false)} />}
      </>
    );
  }

  /* -------------------------------- pitch --------------------------------- */

  if (dismissed) return null;

  const live = data.available.length;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <Eyebrow>Your devices</Eyebrow>
        <button
          type="button"
          onClick={() => {
            window.localStorage.setItem(DISMISS_KEY, "1");
            setDismissed(true);
          }}
          aria-label="Hide this"
          className="px-1 font-body text-sm leading-none text-muted"
        >
          ✕
        </button>
      </div>

      <p className="font-body text-sm text-foreground">
        {live > 0
          ? "Sync your ring or watch and see sleep and recovery next to your lab results."
          : "Wearable device syncing is coming soon."}
      </p>
      <p className="font-body text-xs text-muted">
        Apple Health and Google Health Connect coming soon.
      </p>

      {live > 0 && (
        <div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-pill border border-border px-4 py-2 font-label text-[0.65rem] uppercase tracking-[0.2em] text-foreground transition-colors hover:border-accent hover:text-accent"
          >
            Connect a device
          </button>
        </div>
      )}
    </Card>
  );
}
