"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, Eyebrow } from "./ui";

/**
 * The Home entry point for device syncing.
 *
 * WHY IT IS HERE AS WELL AS IN SETTINGS. These are two different jobs and only
 * one of them belongs in Settings. Connecting a device is a thing you do once,
 * and nobody browses Settings looking for a feature they do not yet know
 * exists, so discovery has to live where people already are, which is Home.
 * Managing connections afterwards (which are on, when they last synced,
 * disconnecting one) is a thing you go looking for, and that is exactly what
 * Settings is for.
 *
 * So: the pitch is here, the controls are there. The full provider list is NOT
 * duplicated, this card links across rather than repeating it, because two
 * copies of the same list is two things to keep in step.
 *
 * It disappears the moment anything is connected. A prompt to do something you
 * have already done is just noise on the screen you see most often.
 */

const DISMISS_KEY = "ikigaro:wearable-card-dismissed";

interface Payload {
  enabled: boolean;
  available: { id: string; name: string }[];
  connections: { provider: string; status: string }[];
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

  if (!data || dismissed) return null;
  // Already syncing something, the pitch is done, get it off the screen.
  if (data.connections.length > 0) return null;

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
