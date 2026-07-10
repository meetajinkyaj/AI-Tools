import "server-only";

/**
 * The Privy app's ES256 public verification key.
 *
 * This is PUBLIC (Privy serves it unauthenticated at
 * `GET https://auth.privy.io/api/v1/apps/<appId>` under `verification_key`), so
 * it is safe to commit. We pass it explicitly to `verifyAuthToken` so tokens are
 * verified LOCALLY with no network call.
 *
 * Why: the Privy SDK's default path fetches this key via an authenticated API
 * request on every verification. That request does not work reliably on
 * Cloudflare Workers, which made every token fail verification (401) in
 * production. Verifying locally with the key removes that dependency entirely.
 *
 * Override with the `PRIVY_VERIFICATION_KEY` env var if the app key is rotated.
 */
const DEFAULT_PRIVY_VERIFICATION_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEniZgvc/LnmV4B5pBK0P08bFLxGAwP8xcZ6epDwHwecnvvZdf9wLKM4H4ThxsmUhKmDrZuAbD6oMoxT3cyX4pNA==
-----END PUBLIC KEY-----`;

export function getPrivyVerificationKey(): string {
  return process.env.PRIVY_VERIFICATION_KEY || DEFAULT_PRIVY_VERIFICATION_KEY;
}
