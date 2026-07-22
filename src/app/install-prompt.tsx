"use client";

import { useEffect, useState } from "react";

import { Card, primaryButtonClass } from "./ui";

/** The non-standard beforeinstallprompt event (Chromium/Edge/Android). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "ikigaro.installPrompt.dismissed";

/** One-time client detection (runs in a lazy initializer, not in an effect, so
 * it never sets state synchronously during an effect). This subtree is
 * client-only (the Privy provider is ssr:false), so window is always defined. */
function detectInitial(): { ios: boolean; show: boolean } {
  if (typeof window === "undefined") return { ios: false, show: false };
  const nav = window.navigator;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (nav as unknown as { standalone?: boolean }).standalone === true;
  if (standalone) return { ios: false, show: false };
  if (localStorage.getItem(DISMISS_KEY) === "1") return { ios: false, show: false };
  const ios =
    /ipad|iphone|ipod/.test(nav.userAgent.toLowerCase()) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;
  // iOS has no beforeinstallprompt — show the manual hint straight away.
  return { ios, show: ios };
}

/**
 * A dismissible "add to home screen" nudge. On Chromium it wires the real
 * beforeinstallprompt event to an Install button; on iOS Safari (no such event)
 * it shows the manual Share → Add to Home Screen hint. Renders nothing when
 * already installed or previously dismissed.
 */
export function InstallPrompt() {
  const [{ ios, show }, setState] = useState(detectInitial);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setState((s) => ({ ...s, show: true }));
    };
    const onInstalled = () => setState((s) => ({ ...s, show: false }));
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setState((s) => ({ ...s, show: false }));
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setState((s) => ({ ...s, show: false }));
  };

  return (
    <Card className="flex flex-col gap-3 border-accent/20 bg-accent/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-body text-sm font-medium text-foreground">
            Add Ikigaro to your home screen
          </p>
          <p className="font-body text-xs text-muted">
            {ios
              ? "Tap the Share button, then “Add to Home Screen” — it opens full-screen and you’ll get daily check-in reminders."
              : "Install it for a full-screen, app-like experience and daily check-in reminders."}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-full px-2 py-1 font-body text-xs text-muted hover:text-foreground"
        >
          Not now
        </button>
      </div>
      {!ios && deferred && (
        <button type="button" onClick={install} className={`${primaryButtonClass} self-start`}>
          Install app
        </button>
      )}
    </Card>
  );
}
