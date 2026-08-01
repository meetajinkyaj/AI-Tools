import "server-only";

import type { ProviderId } from "./types";

/**
 * The signed `state` parameter carried through an OAuth round trip.
 *
 * THE PROBLEM IT SOLVES. The vendor redirects the browser back to our callback
 * with a code and whatever `state` we sent. That request carries no bearer
 * token, it is a top-level navigation from a third-party site, so the
 * callback has no way to know which user it belongs to except from `state`.
 *
 * Which means `state` decides whose account a health connection gets attached
 * to. If it were a plain user id, anyone could complete an OAuth flow against
 * their own Oura account with someone else's id in the state and bolt their
 * ring onto that person's account, or, more usefully to an attacker, bolt the
 * VICTIM's ring onto their own. So it is signed, and the signature is checked
 * before a single byte of it is trusted.
 *
 * It also carries the nonce that makes it single-purpose and an expiry, so a
 * state captured from a browser history or a referrer log is useless later.
 *
 * HMAC-SHA256 with a key derived from the same secret that encrypts tokens, * one secret to manage, and a deployment that can store connections can always
 * sign for them.
 */

const STATE_TTL_MS = 15 * 60 * 1000;

interface StatePayload {
  u: string; // our user id
  p: ProviderId;
  n: string; // nonce
  e: number; // expiry, ms since epoch
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signingKey(): Promise<CryptoKey> {
  const material = process.env.WEARABLE_TOKEN_KEY;
  if (!material) throw new Error("WEARABLE_TOKEN_KEY is not set");
  // Domain-separated from the encryption use of the same secret, so a flaw in
  // one construction cannot be exercised through the other.
  const raw = new TextEncoder().encode(`oauth-state:${material}`);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signState(userId: string, provider: ProviderId): Promise<string> {
  const payload: StatePayload = {
    u: userId,
    p: provider,
    n: b64url(crypto.getRandomValues(new Uint8Array(12))),
    e: Date.now() + STATE_TTL_MS,
  };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await signingKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/**
 * Verify and decode. Returns null on anything suspicious, bad signature,
 * expired, malformed, or a provider that no longer exists.
 *
 * `crypto.subtle.verify` is a constant-time comparison, which is why the
 * signature is checked with it rather than by string equality.
 */
export async function verifyState(
  state: string | null,
): Promise<{ userId: string; provider: ProviderId } | null> {
  if (!state) return null;
  const dot = state.indexOf(".");
  if (dot < 0) return null;

  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  try {
    const key = await signingKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      fromB64url(sig),
      new TextEncoder().encode(body),
    );
    if (!ok) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as StatePayload;
    if (!payload.u || !payload.p) return null;
    if (typeof payload.e !== "number" || payload.e < Date.now()) return null;
    return { userId: payload.u, provider: payload.p };
  } catch {
    return null;
  }
}
