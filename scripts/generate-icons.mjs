/**
 * Regenerates every app icon from the single brand master.
 *
 *   node scripts/generate-icons.mjs
 *
 * Source of truth: `brand/ikigaro-app-icon-512.png`, the app icon exactly as
 * it appears in the Ikigaro Logo Pack. Lowercase Cormorant "i" in Onsen Linen
 * with a Clay Ember tittle, on an Obsidian Stone rounded square.
 *
 * When the brand pack changes, replace that one file and re-run this. Do not
 * hand-edit anything in `public/`, it is all derived.
 *
 * WHY TWO SILHOUETTES. The pack's master has transparent rounded corners,
 * which is right for `purpose: "any"` (launchers draw it as-is) and wrong for
 * `purpose: "maskable"` and iOS, both of which apply their OWN mask. Feeding
 * those a pre-rounded icon double-rounds it and leaves dark slivers at the
 * corners, so they get a full-bleed square instead.
 *
 * The glyph occupies the middle ~38% of the master, well inside the maskable
 * safe zone (the centre circle of 80% diameter), so squaring off the corners
 * is all that is needed, no re-centring or rescaling.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = path.join(ROOT, "brand", "ikigaro-app-icon-512.png");
const PUBLIC = path.join(ROOT, "public");
const APP = path.join(ROOT, "src", "app");

/** Obsidian Stone, the master's own background, sampled from the pack. */
const OBSIDIAN = { r: 0x1b, g: 0x18, b: 0x15, alpha: 1 };

/** Rounded silhouette, alpha preserved. */
function rounded(size) {
  return sharp(MASTER).resize(size, size, { fit: "cover" }).png({ compressionLevel: 9 });
}

/** Full-bleed square: the same art flattened onto Obsidian Stone. */
function square(size) {
  return sharp(MASTER)
    .resize(size, size, { fit: "cover" })
    .flatten({ background: OBSIDIAN })
    .png({ compressionLevel: 9 });
}

/**
 * A minimal multi-image ICO. Browsers want 16/32/48 in the favicon, and
 * `sharp` has no ICO encoder, so we wrap PNG frames in the container by hand, * the ICO format permits PNG-compressed frames and every browser since IE11
 * reads them.
 *
 * The frames MUST be RGBA. Flattening onto Obsidian Stone drops the alpha
 * channel, and Next's build-time icon decoder rejects a non-RGBA PNG inside an
 * ICO outright ("The PNG is not in RGBA format!"), failing the whole build.
 */
async function ico(sizes) {
  const frames = await Promise.all(
    sizes.map(async (size) => ({
      size,
      data: await square(size).ensureAlpha().png({ compressionLevel: 9 }).toBuffer(),
    })),
  );

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);

  const DIR_ENTRY = 16;
  let offset = header.length + frames.length * DIR_ENTRY;
  const entries = frames.map((frame) => {
    const entry = Buffer.alloc(DIR_ENTRY);
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 0); // 0 means 256
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 1);
    entry.writeUInt8(0, 2); // palette size: not paletted
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(frame.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += frame.data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...frames.map((f) => f.data)]);
}

async function main() {
  await mkdir(PUBLIC, { recursive: true });

  const outputs = [
    // purpose: "any", the designed silhouette, drawn unmodified.
    [path.join(PUBLIC, "icon-192.png"), rounded(192)],
    [path.join(PUBLIC, "icon-512.png"), rounded(512)],
    // purpose: "maskable". Android crops this to its own shape.
    [path.join(PUBLIC, "icon-maskable-512.png"), square(512)],
    // iOS rounds the home-screen icon itself and fills transparency with black.
    [path.join(PUBLIC, "apple-touch-icon.png"), square(180)],
  ];

  for (const [file, pipeline] of outputs) {
    await pipeline.toFile(file);
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }

  const favicon = path.join(APP, "favicon.ico");
  await writeFile(favicon, await ico([16, 32, 48]));
  console.log(`wrote ${path.relative(ROOT, favicon)}`);
}

await main();
