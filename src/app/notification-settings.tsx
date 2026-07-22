"use client";

import { useEffect, useState } from "react";

import { PUSH_ENABLED } from "@/lib/vapid-public-key";
import {
  disablePush,
  enablePush,
  getPushState,
  type PushState,
} from "./push-client";
import { Card, Eyebrow, primaryButtonClass, secondaryButtonClass } from "./ui";

/**
 * "Daily reminders" control in Settings. Turning it on requests notification
 * permission and subscribes this device to push; turning it off unsubscribes.
 * Hidden entirely until a real VAPID key is configured (PUSH_ENABLED).
 */
export function NotificationSettings({
  getToken,
}: {
  getToken: () => Promise<string | null>;
}) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getPushState().then((s) => {
      if (active) setState(s);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!PUSH_ENABLED || state === "unsupported") return null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      setState(on ? await enablePush(getToken) : await disablePush(getToken));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 p-5">
      <Eyebrow>Daily reminders</Eyebrow>
      <div className="flex items-start justify-between gap-4">
        <p className="min-w-0 font-body text-sm text-muted">
          A nudge at 6 PM to log your energy, sleep and training — one a day, only
          if you haven&rsquo;t checked in yet.
        </p>
        {state === "on" ? (
          <button
            type="button"
            onClick={() => toggle(false)}
            disabled={busy}
            className={`${secondaryButtonClass} shrink-0`}
          >
            {busy ? "…" : "Turn off"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => toggle(true)}
            disabled={busy || state === "denied" || state === null}
            className={`${primaryButtonClass} shrink-0`}
          >
            {busy ? "…" : "Turn on"}
          </button>
        )}
      </div>
      {state === "denied" && (
        <p className="font-body text-xs text-accent-hover">
          Notifications are blocked for this site. Enable them in your browser
          settings, then try again.
        </p>
      )}
    </Card>
  );
}
