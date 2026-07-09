import "server-only";

import { PrivyClient } from "@privy-io/server-auth";

/**
 * Server-only Privy client, used to verify access tokens and look up users.
 * Requires the App Secret, so this must never reach the browser.
 */
export function createPrivyServer() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error(
      "Missing NEXT_PUBLIC_PRIVY_APP_ID or PRIVY_APP_SECRET in the environment.",
    );
  }

  return new PrivyClient(appId, appSecret);
}
