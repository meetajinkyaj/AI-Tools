"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (public/sw.js) once, on the client, after load.
 * This is what makes Ikigaro installable and enables the offline fallback +
 * (later) push reminders. Renders nothing.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((err) => console.error("Service worker registration failed:", err));
    };
    // Register after the page has loaded so it never competes with first paint.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
