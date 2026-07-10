"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef } from "react";

/**
 * After a successful Privy login, POST the access token (for server-side
 * verification) and the user's email to /api/auth/sync, which upserts the user
 * into Supabase. Runs once per authenticated session (guarded by a ref) and
 * resets on logout.
 */
export function useSyncUser() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!ready) return;

    if (!authenticated) {
      syncedRef.current = false;
      return;
    }

    if (syncedRef.current) return;
    syncedRef.current = true;

    (async () => {
      try {
        const token = await getAccessToken();
        const email = user?.email?.address;
        if (!token || !email) {
          syncedRef.current = false;
          return;
        }

        const res = await fetch("/api/auth/sync", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        });

        if (!res.ok) {
          // Allow a retry on the next effect run if the sync failed.
          syncedRef.current = false;
          console.error("User sync failed:", res.status, await res.text());
        }
      } catch (err) {
        syncedRef.current = false;
        console.error("User sync error:", err);
      }
    })();
  }, [ready, authenticated, user, getAccessToken]);
}
