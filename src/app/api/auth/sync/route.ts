import { NextResponse } from "next/server";

import { createPrivyServer } from "@/lib/privy-server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * POST /api/auth/sync
 *
 * Called by the client right after a successful Privy login. It:
 *   1. Verifies the caller's Privy access token server-side.
 *   2. Looks up the verified user's email from Privy.
 *   3. Upserts a row in `users` keyed on the Privy user id.
 *   4. Appends a `user_created` (first login) or `user_signed_in` event.
 *
 * The client never touches the database directly — all writes happen here,
 * behind a verified token, using the Supabase service-role key.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }

  const privy = createPrivyServer();

  // 1. Verify the token. Throws if invalid/expired.
  let userId: string;
  try {
    const claims = await privy.verifyAuthToken(token);
    userId = claims.userId;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // 2. Look up the verified user's email from Privy.
  const privyUser = await privy.getUser(userId);
  const email = privyUser.email?.address;

  if (!email) {
    return NextResponse.json(
      { error: "No email on Privy account" },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdmin();

  // 3. Is this a first-time login or a returning user?
  const { data: existing, error: selectError } = await supabase
    .from("users")
    .select("id, email")
    .eq("privy_user_id", userId)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  let userRow: { id: string };
  let eventType: string;

  if (!existing) {
    const { data, error } = await supabase
      .from("users")
      .insert({ privy_user_id: userId, email })
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to create user" },
        { status: 500 },
      );
    }
    userRow = data;
    eventType = "user_created";
  } else {
    // Keep email in sync if it changed at Privy; touch updated_at via trigger.
    if (existing.email !== email) {
      const { error } = await supabase
        .from("users")
        .update({ email })
        .eq("id", existing.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    userRow = { id: existing.id };
    eventType = "user_signed_in";
  }

  // 4. Append to the event timeline (best-effort; don't fail the request on it).
  await supabase
    .from("events")
    .insert({ user_id: userRow.id, type: eventType });

  return NextResponse.json({
    user: { id: userRow.id, email },
    created: eventType === "user_created",
  });
}
