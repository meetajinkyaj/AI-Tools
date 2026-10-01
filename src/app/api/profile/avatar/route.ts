import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import {
  AVATAR_BUCKET,
  AVATAR_URL_TTL_SECONDS,
  avatarObjectPath,
  checkAvatarUpload,
} from "@/lib/avatar";
import { getOrCreateSelfProfileId } from "@/lib/profiles";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * The member's profile photo.
 *
 *   POST   /api/profile/avatar   body: the image bytes -> { avatar_url }
 *   DELETE /api/profile/avatar                         -> { avatar_url: null }
 *
 * The body is the raw image, not a form: the phone has already cropped and
 * shrunk it, so there is exactly one file and nothing else to send. The bytes
 * are checked (size, then what they really are) before anything is stored.
 *
 * Stored in the PRIVATE `avatars` bucket (migration 0025) under the profile's
 * own folder. Only the path is kept on the profile; links are signed per load.
 */

const NOT_ENABLED =
  "Profile photos aren't switched on yet. Please try again later.";

/** Postgres "undefined column", or storage reporting the bucket missing. */
function isNotMigrated(message: string | undefined): boolean {
  return !!message && /avatar_path|does not exist|bucket not found/i.test(message);
}

async function resolveProfile(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) return { error: NextResponse.json({ error: "Invalid token" }, { status: 401 }) };
  const userId = await resolveApprovedUserId(privyUserId);
  if (!userId) return { error: NextResponse.json({ error: "User not found" }, { status: 409 }) };
  return { profileId: await getOrCreateSelfProfileId(userId) };
}

export async function POST(request: Request) {
  try {
    const resolved = await resolveProfile(request);
    if ("error" in resolved) return resolved.error;
    const { profileId } = resolved;

    const bytes = new Uint8Array(await request.arrayBuffer());
    const check = checkAvatarUpload(bytes);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const supabase = createSupabaseAdmin();

    // The current photo, so it can be removed once the new one is in place.
    const { data: current, error: readError } = await supabase
      .from("profiles")
      .select("avatar_path")
      .eq("id", profileId)
      .maybeSingle();
    if (readError) {
      if (isNotMigrated(readError.message)) {
        return NextResponse.json({ error: NOT_ENABLED }, { status: 503 });
      }
      throw new Error(`profiles read failed: ${readError.message}`);
    }

    const path = avatarObjectPath(profileId, check.type, crypto.randomUUID());
    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, bytes, { contentType: check.type, upsert: false });
    if (uploadError) {
      if (isNotMigrated(uploadError.message)) {
        return NextResponse.json({ error: NOT_ENABLED }, { status: 503 });
      }
      throw new Error(`avatar upload failed: ${uploadError.message}`);
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_path: path })
      .eq("id", profileId);
    if (updateError) {
      // Do not leave an orphan behind if the profile could not point at it.
      await supabase.storage.from(AVATAR_BUCKET).remove([path]);
      throw new Error(`profiles update failed: ${updateError.message}`);
    }

    // The old photo goes only after the new one is saved, so a failure part
    // way through never leaves the member with no photo at all.
    const old = (current as { avatar_path?: string | null } | null)?.avatar_path;
    if (old && old !== path) await supabase.storage.from(AVATAR_BUCKET).remove([old]);

    const { data: signed } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, AVATAR_URL_TTL_SECONDS);
    return NextResponse.json({ avatar_url: signed?.signedUrl ?? null });
  } catch (err) {
    console.error("POST /api/profile/avatar failed:", err);
    return NextResponse.json({ error: "Couldn't save your photo. Please try again." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const resolved = await resolveProfile(request);
    if ("error" in resolved) return resolved.error;
    const { profileId } = resolved;
    const supabase = createSupabaseAdmin();

    const { data: current, error: readError } = await supabase
      .from("profiles")
      .select("avatar_path")
      .eq("id", profileId)
      .maybeSingle();
    if (readError) {
      if (isNotMigrated(readError.message)) return NextResponse.json({ avatar_url: null });
      throw new Error(`profiles read failed: ${readError.message}`);
    }
    const old = (current as { avatar_path?: string | null } | null)?.avatar_path;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_path: null })
      .eq("id", profileId);
    if (updateError) throw new Error(`profiles update failed: ${updateError.message}`);
    if (old) await supabase.storage.from(AVATAR_BUCKET).remove([old]);

    return NextResponse.json({ avatar_url: null });
  } catch (err) {
    console.error("DELETE /api/profile/avatar failed:", err);
    return NextResponse.json({ error: "Couldn't remove your photo. Please try again." }, { status: 500 });
  }
}
