import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptToken,
  encryptToken,
  wearableKeyProblem,
  wearablesConfigured,
} from "./crypto";
import { tokenColumns } from "./sync";
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
    // hold the same token, and GCM's security collapses on IV reuse.
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
    // The alternative, quietly writing plaintext into a column named `_enc`, // is worse, because nothing about it looks wrong afterwards.
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

describe("the key itself", () => {
  /**
   * THE BUG THIS EXISTS FOR. `atob` on Workers rejects the base64url alphabet
   * and unpadded input. The key was decoded with a bare `atob` deep inside
   * `encryptToken`, so a key that was merely spelled base64url threw
   * `InvalidCharacterError` from the middle of the OAuth callback. It surfaced
   * as "wearable callback failed for ultrahuman: ... invalid base64-encoded
   * data", which reads like the vendor rejected us, and sent the investigation
   * at Ultrahuman's token endpoint instead of at our own secret.
   */

  // Same 32 bytes as KEY_A, spelled base64url and unpadded.
  const KEY_A_URLSAFE = KEY_A.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  it("accepts a base64url key, unpadded", async () => {
    process.env.WEARABLE_TOKEN_KEY = KEY_A_URLSAFE;
    expect(wearableKeyProblem()).toBeNull();
    expect(await decryptToken(await encryptToken("rt_x"))).toBe("rt_x");
  });

  it("treats base64url and standard spellings as the same key", async () => {
    // Not a cosmetic point: if they decoded differently, re-spelling the secret
    // would silently orphan every token already stored under the other form.
    const stored = await encryptToken("rt_same");
    process.env.WEARABLE_TOKEN_KEY = KEY_A_URLSAFE;
    expect(await decryptToken(stored)).toBe("rt_same");
  });

  it("tolerates a trailing newline from a paste", async () => {
    process.env.WEARABLE_TOKEN_KEY = `${KEY_A}\n`;
    expect(wearableKeyProblem()).toBeNull();
  });

  it("names an undecodable key instead of throwing base64 at the caller", async () => {
    process.env.WEARABLE_TOKEN_KEY = "not valid base64 !!!";
    expect(wearableKeyProblem()).toMatch(/not decodable as base64/);
    // And the throw from the encrypt path says which secret, not which builtin.
    await expect(encryptToken("rt_x")).rejects.toThrow(/WEARABLE_TOKEN_KEY/);
  });

  it("names a wrong-length key, with the length it got", async () => {
    process.env.WEARABLE_TOKEN_KEY = "YWJjZA=="; // 4 bytes
    expect(wearableKeyProblem()).toMatch(/4 bytes/);
  });

  it("reports a missing key without pretending it is malformed", () => {
    delete process.env.WEARABLE_TOKEN_KEY;
    expect(wearableKeyProblem()).toMatch(/is not set/);
  });

  it("never puts the key material in the reason, which is logged", () => {
    process.env.WEARABLE_TOKEN_KEY = "sup3rsecret-but-not-base64-!!!";
    const reason = wearableKeyProblem()!;
    expect(reason).not.toContain("sup3rsecret");
  });
});

describe("the credential columns a connection is written with", () => {
  /**
   * THE INCIDENT THIS EXISTS FOR, 2026-08-03. The callback wrote the connection
   * row and its tokens as two separate statements with no transaction around
   * them. Encryption threw between the two, and production was left holding a
   * row with `status = 'active'`, no access token, no refresh token, no expiry,
   * and `last_error` null because no sync had ever failed. The UI rendered
   * "Disconnect". It looked like success from every angle available to a user
   * or to us.
   *
   * The fix is ordering: encrypt first, then write once. These assert the shape
   * that makes the single write possible.
   */

  it("carries everything the row needs to be usable", async () => {
    const cols = await tokenColumns({
      accessToken: "at_1",
      refreshToken: "rt_1",
      expiresIn: 3600,
      scope: "profile ring_data",
      externalUserId: "uh_42",
    });
    expect(await decryptToken(cols.access_token_enc as string)).toBe("at_1");
    expect(await decryptToken(cols.refresh_token_enc as string)).toBe("rt_1");
    expect(cols.scopes).toBe("profile ring_data");
    expect(cols.external_user_id).toBe("uh_42");
    expect(Date.parse(cols.expires_at as string)).toBeGreaterThan(Date.now());
  });

  it("never emits a plaintext token", async () => {
    const cols = await tokenColumns({ accessToken: "at_secret", refreshToken: "rt_secret" });
    expect(JSON.stringify(cols)).not.toContain("at_secret");
    expect(JSON.stringify(cols)).not.toContain("rt_secret");
  });

  it("omits the refresh token rather than blanking it when the vendor sends none", async () => {
    // Several vendors return a refresh token only at first grant. Writing null
    // over a good one on a later refresh would kill the connection.
    const cols = await tokenColumns({ accessToken: "at_1" });
    expect("refresh_token_enc" in cols).toBe(false);
  });

  it("throws before producing any column when the key is unusable", async () => {
    // This is the ordering that matters. If it throws here, the caller has
    // nothing to write, so no half-connection can reach the database.
    process.env.WEARABLE_TOKEN_KEY = "not base64 !!!";
    await expect(tokenColumns({ accessToken: "at_1" })).rejects.toThrow(/WEARABLE_TOKEN_KEY/);
  });
});
