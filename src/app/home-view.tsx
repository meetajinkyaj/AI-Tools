"use client";

import { usePrivy } from "@privy-io/react-auth";

import { AuthedApp } from "./authed-app";
import { Landing } from "./landing";
import { CenteredMessage } from "./ui";

/**
 * Top-level client view. Decides between the signed-out landing page and the
 * authenticated app based on Privy's state.
 */
export function HomeView() {
  const { ready, authenticated } = usePrivy();

  if (!ready) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }
  if (!authenticated) {
    return <Landing />;
  }
  return <AuthedApp />;
}
