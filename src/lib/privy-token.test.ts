import { describe, expect, it } from "vitest";

import { verifyPrivyTokenWithKey } from "./privy-token";

const APP_ID = "test-app-id";
const OTHER_APP_ID = "some-other-app";

// Generate a throwaway ES256 keypair, mint Privy-shaped tokens with it, and use
// its public key as the verification key. This exercises the real crypto path
// (crypto.subtle) end to end without any live Privy dependency.
const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

const verificationKeyPem = await exportSpkiPem(keyPair.publicKey);

async function exportSpkiPem(key: CryptoKey): Promise<string> {
  const der = new Uint8Array(await crypto.subtle.exportKey("spki", key));
  const b64 = btoa(String.fromCharCode(...der));
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface Claims {
  iss?: string;
  aud?: string;
  sub?: string;
  iat?: number;
  exp?: number;
}

async function mintToken(claims: Claims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: "JWT" };
  const payload = {
    iss: "privy.io",
    aud: APP_ID,
    sub: "did:privy:test-user",
    iat: now,
    exp: now + 3600,
    ...claims,
  };
  const enc = (obj: unknown) =>
    base64Url(new TextEncoder().encode(JSON.stringify(obj)));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${base64Url(signature)}`;
}

describe("verifyPrivyTokenWithKey", () => {
  it("verifies a valid token and returns its subject", async () => {
    const token = await mintToken({});
    await expect(
      verifyPrivyTokenWithKey(token, APP_ID, verificationKeyPem),
    ).resolves.toBe("did:privy:test-user");
  });

  it("rejects a token with a tampered signature", async () => {
    const token = await mintToken({});
    const tampered = token.slice(0, -3) + (token.endsWith("AAA") ? "BBB" : "AAA");
    await expect(
      verifyPrivyTokenWithKey(tampered, APP_ID, verificationKeyPem),
    ).rejects.toThrow();
  });

  it("rejects a token whose payload was altered after signing", async () => {
    const token = await mintToken({});
    const [h, , s] = token.split(".");
    const forgedPayload = base64Url(
      new TextEncoder().encode(
        JSON.stringify({
          iss: "privy.io",
          aud: APP_ID,
          sub: "did:privy:attacker",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
    );
    await expect(
      verifyPrivyTokenWithKey(`${h}.${forgedPayload}.${s}`, APP_ID, verificationKeyPem),
    ).rejects.toThrow(/signature/i);
  });

  it("rejects a token for a different audience", async () => {
    const token = await mintToken({ aud: OTHER_APP_ID });
    await expect(
      verifyPrivyTokenWithKey(token, APP_ID, verificationKeyPem),
    ).rejects.toThrow(/audience/i);
  });

  it("rejects a token with the wrong issuer", async () => {
    const token = await mintToken({ iss: "evil.example" });
    await expect(
      verifyPrivyTokenWithKey(token, APP_ID, verificationKeyPem),
    ).rejects.toThrow(/issuer/i);
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = await mintToken({ iat: past - 3600, exp: past });
    await expect(
      verifyPrivyTokenWithKey(token, APP_ID, verificationKeyPem),
    ).rejects.toThrow(/expired/i);
  });

  it("rejects a malformed token", async () => {
    await expect(
      verifyPrivyTokenWithKey("not-a-jwt", APP_ID, verificationKeyPem),
    ).rejects.toThrow(/malformed/i);
  });
});
