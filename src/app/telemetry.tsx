"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef } from "react";

/**
 * Invisible telemetry: reports uncaught client errors (window error +
 * unhandledrejection) and pings one app_opened beacon per session once the
 * user is authenticated. Renders nothing; never throws; hard-capped at a few
 * reports per session so an error loop can't flood the endpoint.
 */

const MAX_REPORTS_PER_SESSION = 5;

export function Telemetry() {
  const { authenticated, getAccessToken } = usePrivy();
  const sent = useRef(0);
  const seen = useRef(new Set<string>());
  const opened = useRef(false);

  // Error capture — registered once, works before and after auth.
  useEffect(() => {
    const report = (message: string, stack?: string) => {
      if (sent.current >= MAX_REPORTS_PER_SESSION) return;
      if (seen.current.has(message)) return;
      seen.current.add(message);
      sent.current++;
      void (async () => {
        let token: string | null = null;
        try {
          token = await getAccessToken();
        } catch {
          /* pre-auth — report anonymously */
        }
        fetch("/api/telemetry", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            kind: "error",
            message,
            stack,
            url: window.location.pathname,
          }),
          keepalive: true,
        }).catch(() => {});
      })();
    };

    const onError = (e: ErrorEvent) => {
      report(e.message || "Unknown error", e.error instanceof Error ? e.error.stack : undefined);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      report(
        r instanceof Error ? `Unhandled rejection: ${r.message}` : `Unhandled rejection: ${String(r)}`,
        r instanceof Error ? r.stack : undefined,
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [getAccessToken]);

  // app_opened — once per session, once the user is signed in.
  useEffect(() => {
    if (!authenticated || opened.current) return;
    opened.current = true;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        await fetch("/api/telemetry", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ kind: "open" }),
          keepalive: true,
        });
      } catch {
        /* telemetry never surfaces */
      }
    })();
  }, [authenticated, getAccessToken]);

  return null;
}
