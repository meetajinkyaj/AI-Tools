"use client";

import { useEffect, useState } from "react";

import { PUSH_ENABLED } from "@/lib/vapid-public-key";
import {
  disablePush,
  enablePush,
  getPushState,
  type PushState,
} from "./push-client";
import { Switch } from "./switch";

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

  /*
   * A SWITCH, WHERE THIS USED TO BE A PAIR OF BUTTONS. "Turn on" and "Turn
   * off" are two controls describing one state, and which of them you see is
   * the only thing telling you what that state currently is. A switch shows
   * the state and changes it with the same object, which is what a setting
   * wants. Same handlers underneath.
   */
  const on = state === "on";
  const locked = busy || state === "denied" || state === null;

  return (
    <section className="iki-card flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="iki-eyebrow">Daily reminder</p>
          <p className="text-caption text-muted">
            A nudge at 6 PM to log your energy, sleep and training, one a day, only
            if you haven&rsquo;t checked in yet.
          </p>
        </div>
        {/* Disabled rather than hidden while the browser has blocked us: the
            control staying put is what makes the sentence below it make sense. */}
        <span className={locked ? "pointer-events-none opacity-50" : undefined}>
          <Switch
            checked={on}
            label="Daily reminder"
            onChange={(next) => void toggle(next)}
          />
        </span>
      </div>
      {state === "denied" && (
        <p className="text-micro text-primary-deep">
          Notifications are blocked for this site. Enable them in your browser
          settings, then try again.
        </p>
      )}
    </section>
  );
}
