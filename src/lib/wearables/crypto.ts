import "server-only";

/**
 * Encryption for stored OAuth tokens.
 *
 * WHY THIS EXISTS AT ALL. A refresh token is not data, it is standing
 * permission: it lets whoever holds it pull a user's sleep, heart rate and
 * recovery from a third party, indefinitely, until someone notices and revokes
 * it. Postgres encrypts at rest at the disk level, which defends against
 * somebody stealing a disk and nothing else, not the realistic threat, which
 * is a leaked service-role key or a stray `pg_dump` sitting in a download
 * folder. Encrypting with a key that lives only in the Worker's secrets means
 * the database on its own is not enough to impersonate our users against six
 * vendors.
 *
 * AES-256-GCM via Web Crypto, which is what the Workers runtime provides.
 * Authenticated, so a tampered ciphertext fails to decrypt rather than
 * returning plausible garbage.
 *
 * IT FAILS CLOSED. No key configured means `encryptToken` throws rather than
 * quietly writing plaintext into a column named `_enc`. A half-configured
 * deployment that stores real tokens unencrypted is worse than one that cannot
 * store them at all, because nothing about it looks wrong afterwards.
 *
 * LOSING THE KEY costs every user a reconnect, annoying, recoverable, and
 * strictly better than the alternative. Rotating it has the same cost, so
 * rotate only if you believe it leaked. There is no re-encrypt path on purpose:
 * writing one means decrypting every token into memory to serve a scenario that
 * should be rare.
 */

const KEY_ENV = "WEARABLE_TOKEN_KEY";
/** GCM's standard nonce length. 96 bits is the size the mode is designed for. */
const IV_BYTES = 12;

let cachedKey: CryptoKey | null = null;
let cachedFrom: string | null = null;

function keyMaterial(): string {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(
      `${KEY_ENV} is not set. Wearable connections cannot be stored without it, ` +
        "generate one with: openssl rand -base64 32",
    );
  }
  return raw;
}

async function getKey(): Promise<CryptoKey> {
  const material = keyMaterial();
  // Re-derive if the secret changed under us (it does across deploys/tests).
  if (cachedKey && cachedFrom === material) return cachedKey;

  const bytes = fromBase64(material);
  if (bytes.length !== 32) {
    throw new Error(
      `${KEY_ENV} must be 32 bytes of base64 (openssl rand -base64 32); got ${bytes.length}`,
    );
  }
  const key = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  cachedKey = key;
  cachedFrom = material;
  return key;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Returns a Uint8Array backed by a real ArrayBuffer.
 *
 * `Uint8Array.from` is typed as `Uint8Array<ArrayBufferLike>`, which could in
 * principle be a SharedArrayBuffer and so is not assignable to Web Crypto's
 * `BufferSource`. Allocating the buffer explicitly pins the type.
 */
function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Encrypt a token for storage.
 *
 * Output is `base64(iv):base64(ciphertext)`. The IV is random per call and
 * stored alongside, that is the correct handling, not a leak: GCM's
 * requirement is that an IV is never REUSED with the same key, not that it is
 * secret. Encrypting the same token twice therefore yields different
 * ciphertext, which is also what stops the column revealing that two users
 * share a value.
 */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return `${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

/**
 * Decrypt a stored token, or null if it cannot be read.
 *
 * Returns null rather than throwing on malformed or untrusted input, a
 * connection whose token will not decrypt is a connection the user has to
 * remake, and the sync sweep should mark it and move on to the next user rather
 * than dying partway through the batch.
 */
export async function decryptToken(stored: string | null): Promise<string | null> {
  if (!stored) return null;
  const sep = stored.indexOf(":");
  if (sep < 0) return null;
  try {
    const iv = fromBase64(stored.slice(0, sep));
    const cipher = fromBase64(stored.slice(sep + 1));
    const key = await getKey();
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    // Wrong key, tampered ciphertext, or truncated column. All the same to us.
    return null;
  }
}

/** Is the feature configured at all? Used to hide the UI rather than break it. */
export function wearablesConfigured(): boolean {
  return Boolean(process.env[KEY_ENV]);
}
