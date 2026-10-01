/**
 * Preparing a profile photo on the phone, before it is uploaded.
 *
 * A centred square crop, scaled to AVATAR_SIZE, encoded as WebP (JPEG where
 * the browser cannot encode WebP). A 12-megapixel camera photo becomes a few
 * tens of kilobytes, which is all a 64px circle needs, and nothing larger ever
 * leaves the device.
 */

export const AVATAR_SIZE = 512;

/** The largest centred square inside a w x h image. */
export function squareCrop(w: number, h: number): { sx: number; sy: number; size: number } {
  const size = Math.min(w, h);
  return { sx: Math.round((w - size) / 2), sy: Math.round((h - size) / 2), size };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * The upload-ready photo, or throws with a message for the member.
 *
 * `createImageBitmap` with `imageOrientation: "from-image"` applies the EXIF
 * rotation, so a portrait taken on a phone is not uploaded on its side. The
 * re-encode also drops every bit of EXIF, including location.
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Pick a photo to use.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That photo couldn't be opened. Try a JPEG or PNG.");
  }
  const { sx, sy, size } = squareCrop(bitmap.width, bitmap.height);
  const out = Math.min(AVATAR_SIZE, size);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("That photo couldn't be prepared.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, out, out);
  bitmap.close();

  // Some browsers cannot encode WebP and quietly hand back a PNG instead;
  // fall back to JPEG rather than upload a needlessly large PNG.
  const webp = await toBlob(canvas, "image/webp", 0.85);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob(canvas, "image/jpeg", 0.85);
  if (!jpeg) throw new Error("That photo couldn't be prepared.");
  return jpeg;
}
