/**
 * Profile photos: the rules the upload route enforces. Pure, so they are
 * tested without storage.
 *
 * The photo is prepared on the phone (cropped square, shrunk to 512px) before
 * it is sent, because a Cloudflare Worker has no image library to do it here.
 * The server therefore does not resize anything; it only refuses what is not
 * a small image.
 */

export const AVATAR_BUCKET = "avatars";
/** Same limit as the bucket's own (migration 0025). */
export const AVATAR_MAX_BYTES = 1024 * 1024;
/** Signed links last six hours; the app falls back to initials if one lapses. */
export const AVATAR_URL_TTL_SECONDS = 6 * 60 * 60;

export type AvatarType = "image/jpeg" | "image/png" | "image/webp";

const EXT: Record<AvatarType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * What the bytes actually are, from their first few bytes, or null.
 *
 * The declared Content-Type is not trusted: it is whatever the client says.
 * The magic numbers are what the file is.
 */
export function sniffImageType(bytes: Uint8Array): AvatarType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  )
    return "image/png";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  )
    return "image/webp";
  return null;
}

export type AvatarCheck =
  | { ok: true; type: AvatarType }
  | { ok: false; status: 400 | 413 | 415; error: string };

/** Size and type, in that order, with the message the member sees. */
export function checkAvatarUpload(bytes: Uint8Array): AvatarCheck {
  if (bytes.length === 0) return { ok: false, status: 400, error: "No photo was received." };
  if (bytes.length > AVATAR_MAX_BYTES) {
    return { ok: false, status: 413, error: "That photo is too large. Try another one." };
  }
  const type = sniffImageType(bytes);
  if (!type) {
    return { ok: false, status: 415, error: "That file isn't a photo we can use. Try a JPEG or PNG." };
  }
  return { ok: true, type };
}

/**
 * Where a photo lives: under the profile's own folder, with a fresh name each
 * time. A new name rather than overwriting means a replaced photo's old
 * signed link stops resolving, instead of quietly showing the new face to
 * whoever still holds it.
 */
export function avatarObjectPath(profileId: string, type: AvatarType, id: string): string {
  return `${profileId}/${id}.${EXT[type]}`;
}
