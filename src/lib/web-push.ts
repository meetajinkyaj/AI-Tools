/**
 * Web Push (RFC 8291 encryption + RFC 8292 VAPID) on the Web Crypto API.
 *
 * Why hand-rolled: the reminder sender needs to run on Cloudflare Workers, and
 * the usual `web-push` package is Node-only. This is the same trade already
 * made for Privy token verification (`verify-privy-token.ts`) and for the same
 * reason, the runtime, not preference.
 *
 * Because this is crypto we wrote ourselves, it is checked against the official
 * RFC 8291 §5 test vector, including the intermediate PRK / CEK / NONCE / header
 * values, so a mistake shows up as a failing unit test rather than as
 * notifications that silently never arrive. See `web-push.test.ts`.
 *
 * Scope: a single AES128GCM record, which covers any payload under ~4KB. Longer
 * payloads would need multi-record framing; ours are two short strings.
 */

const RECORD_SIZE = 4096;
const PADDING_DELIMITER = 0x02; // last record (RFC 8188 §2)

/* ---------------------------------- base64url --------------------------- */

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A copy in its own ArrayBuffer. TS's BufferSource rejects Uint8Array views. */
function buf(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.length);
  new Uint8Array(ab).set(bytes);
  return ab;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/* ------------------------------- HKDF pieces ---------------------------- */

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw",
    buf(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, buf(data)));
}

/**
 * One-block HKDF (extract + expand), which is all Web Push needs, every
 * output here is ≤32 bytes, so the expand loop never runs twice.
 */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

/* ------------------------------- EC key import -------------------------- */

/** An uncompressed P-256 point (0x04 ‖ X ‖ Y) as a JWK's x/y pair. */
function pointToXY(publicKey: Uint8Array): { x: string; y: string } {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error("Expected a 65-byte uncompressed P-256 public key");
  }
  return {
    x: bytesToB64url(publicKey.slice(1, 33)),
    y: bytesToB64url(publicKey.slice(33, 65)),
  };
}

async function importPrivateKey(
  privateScalar: Uint8Array,
  publicKey: Uint8Array,
  algorithm: "ECDH" | "ECDSA",
): Promise<CryptoKey> {
  const { x, y } = pointToXY(publicKey);
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d: bytesToB64url(privateScalar), ext: true },
    { name: algorithm, namedCurve: "P-256" },
    false,
    algorithm === "ECDH" ? ["deriveBits"] : ["sign"],
  );
}

async function importPublicKey(publicKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    buf(publicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

/* ------------------------------- encryption ----------------------------- */

export interface EncryptResult {
  body: Uint8Array;
  /** Intermediates, exposed so the RFC test vector can assert each step. */
  debug: { prk: Uint8Array; cek: Uint8Array; nonce: Uint8Array; header: Uint8Array };
}

/**
 * Encrypt a push payload for one subscription (RFC 8291 §3.4).
 *
 * `salt` and `senderKeys` are injectable purely so the RFC test vector can be
 * reproduced; production always uses fresh random values.
 */
export async function encryptPayload(opts: {
  payload: Uint8Array;
  /** Subscription `keys.p256dh`, the user agent's public key, raw 65 bytes. */
  userPublicKey: Uint8Array;
  /** Subscription `keys.auth`, 16-byte shared auth secret. */
  authSecret: Uint8Array;
  salt?: Uint8Array;
  senderKeys?: { publicKey: Uint8Array; privateKey: Uint8Array };
}): Promise<EncryptResult> {
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let asPublic: Uint8Array;
  let asPrivateKey: CryptoKey;
  if (opts.senderKeys) {
    asPublic = opts.senderKeys.publicKey;
    asPrivateKey = await importPrivateKey(
      opts.senderKeys.privateKey,
      opts.senderKeys.publicKey,
      "ECDH",
    );
  } else {
    const pair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    asPrivateKey = pair.privateKey;
  }

  // ecdh_secret = ECDH(as_private, ua_public)
  const uaPublicKey = await importPublicKey(opts.userPublicKey);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaPublicKey },
      asPrivateKey,
      256,
    ),
  );

  // IKM = HKDF(salt=auth_secret, IKM=ecdh_secret,
  //            info="WebPush: info" ‖ 0x00 ‖ ua_public ‖ as_public, L=32)
  const keyInfo = concat(
    utf8("WebPush: info"),
    new Uint8Array([0]),
    opts.userPublicKey,
    asPublic,
  );
  const ikm = await hkdf(opts.authSecret, ecdhSecret, keyInfo, 32);

  // Content encryption key + nonce (RFC 8188 §2.2)
  const prk = await hmac(salt, ikm);
  const cek = await hkdf(
    salt,
    ikm,
    concat(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    concat(utf8("Content-Encoding: nonce"), new Uint8Array([0])),
    12,
  );

  // header = salt ‖ rs (uint32be) ‖ idlen (uint8) ‖ keyid (as_public)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE, false);
  const header = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic);

  const aesKey = await crypto.subtle.importKey("raw", buf(cek), "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: buf(nonce), tagLength: 128 },
      aesKey,
      buf(concat(opts.payload, new Uint8Array([PADDING_DELIMITER]))),
    ),
  );

  return { body: concat(header, ciphertext), debug: { prk, cek, nonce, header } };
}

/* ---------------------------------- VAPID ------------------------------- */

/**
 * The `Authorization: vapid …` header for one push endpoint (RFC 8292).
 * The JWT is audience-scoped to the endpoint's origin and short-lived.
 */
export async function vapidAuthorization(opts: {
  endpoint: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  subject: string;
  expiresInSeconds?: number;
  now?: () => number;
}): Promise<string> {
  const now = opts.now ? opts.now() : Date.now();
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: new URL(opts.endpoint).origin,
    exp: Math.floor(now / 1000) + (opts.expiresInSeconds ?? 12 * 60 * 60),
    sub: opts.subject,
  };

  const signingInput = `${bytesToB64url(utf8(JSON.stringify(header)))}.${bytesToB64url(
    utf8(JSON.stringify(claims)),
  )}`;

  const key = await importPrivateKey(opts.privateKey, opts.publicKey, "ECDSA");
  // Web Crypto returns the raw r‖s pair, which is exactly JWS ES256 form.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      buf(utf8(signingInput)),
    ),
  );

  const jwt = `${signingInput}.${bytesToB64url(signature)}`;
  return `vapid t=${jwt}, k=${bytesToB64url(opts.publicKey)}`;
}

/* --------------------------------- sending ------------------------------ */

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SendResult {
  ok: boolean;
  status: number;
  /** True when the endpoint says this subscription is dead and should be dropped. */
  expired: boolean;
}

/**
 * Deliver one notification. Never throws, a single bad subscription must not
 * stop the rest of the batch.
 */
export async function sendPush(opts: {
  subscription: PushSubscription;
  payload: string;
  vapid: { publicKey: string; privateKey: string; subject: string };
  ttlSeconds?: number;
}): Promise<SendResult> {
  try {
    const { body } = await encryptPayload({
      payload: utf8(opts.payload),
      userPublicKey: b64urlToBytes(opts.subscription.keys.p256dh),
      authSecret: b64urlToBytes(opts.subscription.keys.auth),
    });

    const authorization = await vapidAuthorization({
      endpoint: opts.subscription.endpoint,
      publicKey: b64urlToBytes(opts.vapid.publicKey),
      privateKey: b64urlToBytes(opts.vapid.privateKey),
      subject: opts.vapid.subject,
    });

    const res = await fetch(opts.subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttlSeconds ?? 12 * 60 * 60),
      },
      body: buf(body),
    });

    // 404/410 mean the subscription is gone for good (RFC 8030 §7.3).
    return {
      ok: res.ok,
      status: res.status,
      expired: res.status === 404 || res.status === 410,
    };
  } catch {
    return { ok: false, status: 0, expired: false };
  }
}
