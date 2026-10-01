import { describe, expect, it } from "vitest";

import { AVATAR_MAX_BYTES, avatarObjectPath, checkAvatarUpload, sniffImageType } from "./avatar";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

describe("sniffImageType", () => {
  it("recognises JPEG, PNG and WebP by their bytes", () => {
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("refuses anything else, whatever it claims to be", () => {
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull(); // RIFF AVI
  });
});

describe("checkAvatarUpload", () => {
  it("accepts a small real image", () => {
    expect(checkAvatarUpload(jpeg)).toEqual({ ok: true, type: "image/jpeg" });
  });

  it("refuses empty, oversized and non-image uploads with a status", () => {
    expect(checkAvatarUpload(new Uint8Array())).toMatchObject({ ok: false, status: 400 });
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
    big.set(jpeg);
    expect(checkAvatarUpload(big)).toMatchObject({ ok: false, status: 413 });
    expect(checkAvatarUpload(new Uint8Array([1, 2, 3, 4]))).toMatchObject({ ok: false, status: 415 });
  });
});

describe("avatarObjectPath", () => {
  it("files the photo under the profile with a fresh name", () => {
    expect(avatarObjectPath("prof-1", "image/webp", "abc")).toBe("prof-1/abc.webp");
  });
});
