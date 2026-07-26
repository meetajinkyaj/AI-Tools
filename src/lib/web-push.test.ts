import { describe, expect, it } from "vitest";

import {
  b64urlToBytes,
  bytesToB64url,
  encryptPayload,
  vapidAuthorization,
} from "./web-push";

/**
 * The official RFC 8291 §5 "Push Message Encryption Example".
 *
 * This is the whole reason hand-rolling the crypto is acceptable: every
 * intermediate the RFC publishes is asserted, so an error surfaces here rather
 * than as notifications that silently never arrive on anyone's phone.
 */
const RFC8291 = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  // Published intermediates
  prk: "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  header:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
} as const;

async function encryptRfcVector() {
  return encryptPayload({
    payload: new TextEncoder().encode(RFC8291.plaintext),
    userPublicKey: b64urlToBytes(RFC8291.uaPublic),
    authSecret: b64urlToBytes(RFC8291.authSecret),
    salt: b64urlToBytes(RFC8291.salt),
    senderKeys: {
      publicKey: b64urlToBytes(RFC8291.asPublic),
      privateKey: b64urlToBytes(RFC8291.asPrivate),
    },
  });
}

describe("base64url", () => {
  it("round-trips, and decodes unpadded input", () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 128, 64]);
    expect(b64urlToBytes(bytesToB64url(bytes))).toEqual(bytes);
    expect(bytesToB64url(bytes)).not.toContain("=");
  });

  it("uses the URL-safe alphabet", () => {
    // 0xfb 0xff encodes to "+/" in standard base64 — must become "-_".
    const s = bytesToB64url(new Uint8Array([251, 255, 191]));
    expect(s).not.toMatch(/[+/]/);
    expect(b64urlToBytes(s)).toEqual(new Uint8Array([251, 255, 191]));
  });
});

describe("RFC 8291 §5 test vector", () => {
  it("derives the published PRK", async () => {
    const { debug } = await encryptRfcVector();
    expect(bytesToB64url(debug.prk)).toBe(RFC8291.prk);
  });

  it("derives the published content encryption key", async () => {
    const { debug } = await encryptRfcVector();
    expect(bytesToB64url(debug.cek)).toBe(RFC8291.cek);
    expect(debug.cek).toHaveLength(16);
  });

  it("derives the published nonce", async () => {
    const { debug } = await encryptRfcVector();
    expect(bytesToB64url(debug.nonce)).toBe(RFC8291.nonce);
    expect(debug.nonce).toHaveLength(12);
  });

  it("builds the published 86-octet header", async () => {
    const { debug } = await encryptRfcVector();
    expect(debug.header).toHaveLength(86);
    expect(bytesToB64url(debug.header)).toBe(RFC8291.header);
  });

  it("produces a body that decrypts back to the plaintext", async () => {
    // Closes the loop: the CEK/nonce above are correct, and the AES-GCM record
    // is framed so a receiver can actually recover the message.
    const { body, debug } = await encryptRfcVector();
    expect(body.slice(0, 86)).toEqual(debug.header);

    const key = await crypto.subtle.importKey(
      "raw",
      debug.cek.slice().buffer,
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: debug.nonce.slice().buffer, tagLength: 128 },
        key,
        body.slice(86).slice().buffer,
      ),
    );

    // Last octet is the RFC 8188 padding delimiter for a final record.
    expect(decrypted[decrypted.length - 1]).toBe(0x02);
    expect(new TextDecoder().decode(decrypted.slice(0, -1))).toBe(RFC8291.plaintext);
  });
});

describe("encryption in production mode", () => {
  it("generates a fresh salt and sender key per message", async () => {
    const args = {
      payload: new TextEncoder().encode("hello"),
      userPublicKey: b64urlToBytes(RFC8291.uaPublic),
      authSecret: b64urlToBytes(RFC8291.authSecret),
    };
    const a = await encryptPayload(args);
    const b = await encryptPayload(args);

    // Reusing a salt or ephemeral key across messages would be a real weakness.
    expect(bytesToB64url(a.debug.header)).not.toBe(bytesToB64url(b.debug.header));
    expect(bytesToB64url(a.debug.cek)).not.toBe(bytesToB64url(b.debug.cek));
    expect(a.debug.header).toHaveLength(86);
  });
});

describe("VAPID authorization (RFC 8292)", () => {
  const vapid = {
    publicKey: b64urlToBytes(RFC8291.asPublic),
    privateKey: b64urlToBytes(RFC8291.asPrivate),
    subject: "mailto:hello@ikigaro.com",
  };

  it("scopes the audience to the endpoint origin, not the full URL", async () => {
    const header = await vapidAuthorization({
      ...vapid,
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123?x=1",
      now: () => 1_700_000_000_000,
    });

    const jwt = header.match(/t=([^,]+)/)?.[1] ?? "";
    const claims = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(jwt.split(".")[1])),
    );
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:hello@ikigaro.com");
    expect(claims.exp).toBe(1_700_000_000 + 12 * 60 * 60);
  });

  it("carries the public key and an ES256 header", async () => {
    const header = await vapidAuthorization({
      ...vapid,
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc",
    });
    expect(header).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(header).toContain(`k=${RFC8291.asPublic}`);

    const jwt = header.match(/t=([^,]+)/)?.[1] ?? "";
    const alg = JSON.parse(new TextDecoder().decode(b64urlToBytes(jwt.split(".")[0])));
    expect(alg).toEqual({ typ: "JWT", alg: "ES256" });
  });

  it("produces a signature that verifies against the public key", async () => {
    // The push service does exactly this check; if it fails, every send 401s.
    const endpoint = "https://fcm.googleapis.com/fcm/send/xyz";
    const header = await vapidAuthorization({ ...vapid, endpoint });
    const jwt = header.match(/t=([^,]+)/)?.[1] ?? "";
    const [h, c, sig] = jwt.split(".");

    const pub = await crypto.subtle.importKey(
      "raw",
      vapid.publicKey.slice().buffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      b64urlToBytes(sig).slice().buffer,
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(valid).toBe(true);
  });
});
