"use client";

import { useEffect, useState } from "react";

import {
  groundFor,
  THEME_LABELS,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  readPreference,
  type ThemePreference,
} from "@/lib/theme";
import { Segmented } from "./segmented";

/**
 * "Appearance" on Profile: System, Light or Dark.
 *
 * THE CLASS IS THE ONLY THING THIS WRITES. Every colour in the app is a token
 * that `globals.css` redefines under `.dark`, so switching the ground is one
 * class on `<html>` and nothing else. No component knows which ground it is in,
 * which is exactly why this was one afternoon's work rather than a rewrite.
 *
 * SYSTEM IS A LIVE SUBSCRIPTION, not a value read once. A member on "System"
 * whose phone switches at dusk should switch with it while the app is open,
 * which means listening to the media query rather than sampling it at mount.
 *
 * The initial read happens after mount. The server has no localStorage and no
 * media query, so anything computed during render would be a hydration
 * mismatch; the no-flash script in `layout.tsx` is what stops that costing a
 * white flash on the way in.
 */
export function ThemeControl() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  const apply = (next: ThemePreference) => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle(
      "dark",
      groundFor(next, dark) === "dark",
    );
  };

  useEffect(() => {
    void (async () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        /* private mode, or storage disabled. System is a fine default. */
      }
      setPreference(readPreference(stored));
    })();
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    // Only "system" cares what the device says; an explicit choice must not be
    // overridden by the sun going down.
    const onChange = () => {
      if (preference === "system") apply("system");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const choose = (next: ThemePreference) => {
    setPreference(next);
    apply(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* the choice still applies for this session */
    }
  };

  return (
    <section className="iki-card flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="iki-eyebrow">Appearance</p>
        <p className="text-caption text-muted">
          System follows your device, and changes with it.
        </p>
      </div>
      <Segmented
        label="Appearance"
        value={preference}
        onChange={choose}
        options={THEME_PREFERENCES.map((p) => ({ value: p, label: THEME_LABELS[p] }))}
      />
    </section>
  );
}
