import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptToken, encryptToken, wearablesConfigured } from "./crypto";
import { signState, verifyState } from "./oauth-state";

/**
 * The two pieces where a bug is a security bug rather than a broken chart:
 * the encryption protecting stored refresh tokens, and the signed `state` that
 * decides whose account an OAuth callback attaches a device to.
 */

const KEY_A = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="; // exactly 32 bytes decoded
const KEY_B = "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=";

const saved = process.env.WEARABLE_TOKEN_KEY;
beforeEach(() => {
  process.env.WEARABLE_TOKEN_KEY = KEY_A;
});
afterEach(() => {
  if (saved === undefined) delete process.env.WEARABLE_TOKEN_KEY;
  else process.env.WEARABLE_TOKEN_KEY = saved;
});

describe("token encryption", () => {
  it("round-trips a token", async () => {
    const secret = "rt_1a2b3c4d5e6f";
    const stored = await encryptToken(secret);
    expect(stored).not.toContain(secret);
    expect(await decryptToken(stored)).toBe(secret);
  });

  it("produces different ciphertext each time", async () => {
    // A random IV per call. Without it, the column would reveal that two rows
    // hold the same token — and GCM's security collapses on IV reuse.
    const a = await encryptToken("same-token");
    const b = await encryptToken("same-token");
    expect(a).not.toBe(b);
    expect(await decryptToken(a)).toBe(await decryptToken(b));
  });

  it("returns null rather than throwing on rubbish", async () => {
    // The sync sweep hits this: an undecryptable row must be marked and
    // stepped over, not allowed to kill the batch mid-way.
    for (const bad of [null, "", "no-separator", "!!!:!!!", "YWJj:YWJj"]) {
      expect(await decryptToken(bad as string | null)).toBeNull();
    }
  });

  it("refuses to decrypt with the wrong key", async () => {
    const stored = await encryptToken("rt_secret");
    process.env.WEARABLE_TOKEN_KEY = KEY_B;
    expect(await decryptToken(stored)).toBeNull();
  });

  it("detects tampering", async () => {
    // GCM is authenticated: a flipped byte must fail, not decrypt to garbage
    // that then gets sent to a vendor as if it were a credential.
    const stored = await encryptToken("rt_secret");
    const [iv, body] = stored.split(":");
    const flipped = body[0] === "A" ? `B${body.slice(1)}` : `A${body.slice(1)}`;
    expect(await decryptToken(`${iv}:${flipped}`)).toBeNull();
  });

  it("fails closed when no key is configured", async () => {
    // The alternative — quietly writing plaintext into a column named `_enc` —
    // is worse, because nothing about it looks wrong afterwards.
    delete process.env.WEARABLE_TOKEN_KEY;
    expect(wearablesConfigured()).toBe(false);
    await expect(encryptToken("rt_secret")).rejects.toThrow(/WEARABLE_TOKEN_KEY/);
  });

  it("rejects a key that is not 32 bytes", async () => {
    process.env.WEARABLE_TOKEN_KEY = "c2hvcnQ=";
    await expect(encryptToken("x")).rejects.toThrow(/32 bytes/);
  });
});

describe("the OAuth state parameter", () => {
  const USER = "11111111-1111-1111-1111-111111111111";

  it("round-trips the user and provider", async () => {
    const state = await signState(USER, "oura");
    expect(await verifyState(state)).toEqual({ userId: USER, provider: "oura" });
  });

  it("rejects a forged state", async () => {
    // THE ATTACK THIS STOPS: the callback is unauthenticated by necessity, so
    // whatever `state` says is whose account the device gets attached to. If it
    // were unsigned, anyone could complete a flow with someone else's user id
    // and bolt a health connection onto their account.
    const state = await signState(USER, "oura");
    const [body] = state.split(".");
    const forgedBody = btoa(JSON.stringify({ u: "victim-id", p: "oura", n: "x", e: Date.now() + 1e6 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await verifyState(`${forgedBody}.anything`)).toBeNull();
    // Same signature, different payload.
    expect(await verifyState(`${forgedBody}.${state.split(".")[1]}`)).toBeNull();
    // Same payload, no signature.
    expect(await verifyState(body)).toBeNull();
  });

  it("rejects a state signed with a different key", async () => {
    const state = await signState(USER, "oura");
    process.env.WEARABLE_TOKEN_KEY = KEY_B;
    expect(await verifyState(state)).toBeNull();
  });

  it("rejects malformed input without throwing", async () => {
    for (const bad of [null, "", ".", "a.b", "!!!.???"]) {
      expect(await verifyState(bad as string | null)).toBeNull();
    }
  });

  it("is single-use in spirit: two states never collide", async () => {
    // The nonce is what stops a state captured from a referrer log or browser
    // history being replayed as a fresh one.
    const a = await signState(USER, "oura");
    const b = await signState(USER, "oura");
    expect(a).not.toBe(b);
  });
});
