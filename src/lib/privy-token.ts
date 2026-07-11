/**
 * Pure, runtime-agnostic verification of a Privy access token (ES256 JWT) using
 * the Web Crypto API (`crypto.subtle`) — a native global on Cloudflare Workers,
 * Node 18+, and browsers. No `node:crypto`, no library, so it behaves identically
 * across build targets (which is exactly the bug we hit with jose on workerd).
 *
 * This module has no server-only imports and reads no secrets, so it is safe to
 * unit test directly. The server entry point is verify-privy-token.ts, which
 * injects the app's public verification key.
 *
 * Returns the verified Privy user id (the token's `sub`) or throws.
 */
export async function verifyPrivyTokenWithKey(
  token: string,
  appId: string,
  verificationKeyPem: string,
): Promise<string> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed token");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  const key = await crypto.subtle.importKey(
    "spki",
    toArrayBuffer(pemToDer(verificationKeyPem)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );

  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    toArrayBuffer(base64UrlToBytes(signatureB64)),
    toArrayBuffer(new TextEncoder().encode(`${headerB64}.${payloadB64}`)),
  );
  if (!valid) {
    throw new Error("Invalid signature");
  }

  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlToBytes(payloadB64)),
  ) as { iss?: string; aud?: string | string[]; exp?: number; sub?: string };

  if (payload.iss !== "privy.io") {
    throw new Error("Unexpected issuer");
  }
  const audOk = Array.isArray(payload.aud)
    ? payload.aud.includes(appId)
    : payload.aud === appId;
  if (!audOk) {
    throw new Error("Unexpected audience");
  }
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }
  if (!payload.sub) {
    throw new Error("Token missing subject");
  }
  return payload.sub;
}

/** Copy into a fresh, exactly-sized ArrayBuffer (satisfies the WebCrypto BufferSource type). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  return base64UrlToBytes(body);
}
