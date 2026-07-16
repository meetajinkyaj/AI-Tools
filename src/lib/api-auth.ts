import "server-only";

import { PRIVY_APP_ID } from "./privy-app-id";
import { verifyPrivyToken } from "./verify-privy-token";

/**
 * Extract and verify the Privy access token from a request's Authorization
 * header. Returns the verified Privy user id, or null if the header is missing
 * or the token is invalid (callers should respond 401). Throws only if the
 * server is misconfigured (missing app id).
 */
export async function getPrivyUserId(request: Request): Promise<string | null> {
  const appId = PRIVY_APP_ID;

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  if (!token) {
    return null;
  }

  try {
    return await verifyPrivyToken(token, appId);
  } catch {
    return null;
  }
}
