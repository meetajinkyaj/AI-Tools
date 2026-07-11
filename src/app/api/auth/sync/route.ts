import { NextResponse } from "next/server";

import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyPrivyToken } from "@/lib/verify-privy-token";

/**
 * POST /api/auth/sync
 *
 * Called by the client right after a successful Privy login. It:
 *   1. Verifies the caller's Privy access token locally (Web Crypto).
 *   2. Upserts a row in `users` keyed on the verified Privy user id.
 *   3. Appends a `user_created` (first login) or `user_signed_in` event.
 *
 * Token verification lives in verify-privy-token.ts, which uses the Web Crypto
 * API directly (jose / @privy-io/server-auth resolve to a node:crypto build that
 * fails on Cloudflare Workers). See privy-verification-key.ts for the key.
 *
 * The verified token is the trusted identity anchor (its `sub` becomes
 * `privy_user_id`, the unique key). The email is taken from the request body:
 * Privy already verified it via OTP at login, and a caller can only ever affect
 * their own row (keyed on their verified id), with the UNIQUE email constraint
 * preventing them from claiming another user's address. Hardening path for later:
 * derive the email server-side from a Privy identity token instead of the body.
 *
 * All DB writes use the Supabase service-role key; the browser never touches the
 * tables directly.
 */
export async function POST(request: Request) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }

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

  // 1. Verify the access token locally against the app's public key.
  let userId: string;
  try {
    userId = await verifyPrivyToken(token, appId);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // 2. Email comes from the request body (see note above).
  let email: string | null = null;
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email === "string" && body.email.includes("@")) {
      email = body.email.trim().toLowerCase();
    }
  } catch {
    // fall through to the missing-email response below
  }

  if (!email) {
    return NextResponse.json(
      { error: "Missing or invalid email" },
      { status: 400 },
    );
  }

  // 3. Upsert the user and log the event. Wrapped so any unexpected failure
  //    returns a readable JSON error instead of an opaque empty 500.
  try {
    const supabase = createSupabaseAdmin();

    // First-time login or returning user?
    const { data: existing, error: selectError } = await supabase
      .from("users")
      .select("id, email")
      .eq("privy_user_id", userId)
      .maybeSingle();

    if (selectError) {
      throw new Error(`users select failed: ${selectError.message}`);
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
        throw new Error(`users insert failed: ${error?.message ?? "no row"}`);
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
          throw new Error(`users update failed: ${error.message}`);
        }
      }
      userRow = { id: existing.id };
      eventType = "user_signed_in";
    }

    // Append to the event timeline (best-effort; don't fail the request on it).
    await supabase
      .from("events")
      .insert({ user_id: userRow.id, type: eventType });

    return NextResponse.json({
      user: { id: userRow.id, email },
      created: eventType === "user_created",
    });
  } catch (err) {
    console.error("auth/sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
