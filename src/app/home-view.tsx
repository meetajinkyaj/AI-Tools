"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect } from "react";

import { AuthedApp } from "./authed-app";
import { Landing } from "./landing";
import { CenteredMessage } from "./ui";

/** Remember an invite code from a ?ref link so signup can attribute it. */
function captureReferral() {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) localStorage.setItem("ikigaro.ref", ref);
  } catch {
    /* attribution is best-effort */
  }
}

/**
 * Top-level client view. Decides between the signed-out landing page and the
 * authenticated app based on Privy's state.
 */
export function HomeView() {
  const { ready, authenticated } = usePrivy();

  useEffect(() => {
    captureReferral();
  }, []);

  if (!ready) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }
  if (!authenticated) {
    return <Landing />;
  }
  return <AuthedApp />;
}
