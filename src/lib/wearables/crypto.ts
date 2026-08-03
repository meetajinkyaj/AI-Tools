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

  const problem = keyProblem(material);
  if (problem) throw new Error(`${KEY_ENV} ${problem}`);
  const bytes = fromBase64(material)!;
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
 * Base64 to bytes, tolerating the base64url alphabet and absent padding.
 * Returns null when the input is not decodable at all.
 *
 * WHY TOLERANT. `atob` on Workers is strict: it rejects `-` and `_`, and
 * rejects a length that is not a multiple of four. Plenty of ordinary ways to
 * produce a 32-byte secret give exactly those, and a key generator that emits
 * base64url is not doing anything wrong. This decoder previously threw
 * `InvalidCharacterError` from deep inside `encryptToken`, which surfaced as
 * "wearable callback failed" with a message about base64 and no indication that
 * a SECRET, not the vendor, was the problem. That cost an afternoon.
 *
 * `oauth-state.ts` has always folded base64url the same way. Two decoders in
 * one directory, one tolerant and one strict, with the strict one holding the
 * encryption key, was the actual defect.
 *
 * Returns a Uint8Array backed by a real ArrayBuffer: `Uint8Array.from` is typed
 * as `Uint8Array<ArrayBufferLike>`, which could in principle be a
 * SharedArrayBuffer and so is not assignable to Web Crypto's `BufferSource`.
 */
function fromBase64(s: string): Uint8Array<ArrayBuffer> | null {
  const folded = s.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = folded + "=".repeat((4 - (folded.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    return null;
  }
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * What is wrong with a candidate key, or null if nothing is.
 *
 * Never includes the value or any part of it: this string reaches logs.
 */
function keyProblem(material: string): string | null {
  const bytes = fromBase64(material);
  if (!bytes) {
    return (
      "is not decodable as base64. Generate a fresh one with " +
      "`openssl rand -base64 32` and set it as a Worker Secret."
    );
  }
  if (bytes.length !== 32) {
    return (
      `decoded to ${bytes.length} bytes; AES-256 needs 32 bytes. ` +
      "Generate one with `openssl rand -base64 32`."
    );
  }
  return null;
}

/**
 * Is the configured key actually usable? Null when it is, a reason when not.
 *
 * Exported so a caller can refuse BEFORE sending a user to a vendor's consent
 * screen. Discovering an unusable key after the user has already approved at
 * Ultrahuman means they did the work and we threw it away.
 */
export function wearableKeyProblem(): string | null {
  const raw = process.env[KEY_ENV];
  if (!raw) return `${KEY_ENV} is not set.`;
  const problem = keyProblem(raw);
  return problem ? `${KEY_ENV} ${problem}` : null;
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
    if (!iv || !cipher) return null;
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
