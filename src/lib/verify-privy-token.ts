import "server-only";

import { getPrivyVerificationKey } from "./privy-verification-key";
import { verifyPrivyTokenWithKey } from "./privy-token";

/**
 * Server entry point for Privy token verification. Injects the app's public
 * verification key into the pure verifier (see privy-token.ts). Returns the
 * verified Privy user id (the token's `sub`) or throws.
 */
export function verifyPrivyToken(token: string, appId: string): Promise<string> {
  return verifyPrivyTokenWithKey(token, appId, getPrivyVerificationKey());
}
