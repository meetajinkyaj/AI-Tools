import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { sendEmail } from "@/lib/email";
import { accessGrantedEmail, shouldSendAccessEmail } from "@/lib/emails/access-granted";
import { normalizeReferralCode } from "@/lib/referral";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/admin/users — a roster with each user's key engagement signals:
 * access status, whether they finished onboarding, points balance, panels
 * uploaded, and last check-in / streak. Aggregated in memory (fine at beta
 * scale). Admin-only.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const supabase = createSupabaseAdmin();
  const [
    { data: users },
    { data: points },
    { data: panels },
    { data: checkins },
    { data: profiles },
  ] = await Promise.all([
      supabase
        .from("users")
        .select("id, email, created_at, deleted_at, access_status, referral_code")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("reward_points").select("user_id, points_balance"),
      supabase.from("biomarker_panels").select("user_id"),
      supabase.from("daily_checkins").select("user_id, checkin_date, streak_count"),
      // Onboarding is "has a self profile" — the exact condition authed-app.tsx
      // uses to decide whether to show the onboarding form or the app. Deriving
      // it from anything else here would let the admin view disagree with what
      // the user is actually looking at.
      supabase.from("profiles").select("user_id").eq("relationship", "self"),
    ]);

  const pointsByUser = new Map<string, number>();
  for (const p of points ?? []) {
    const r = p as { user_id: string; points_balance: number };
    pointsByUser.set(r.user_id, (pointsByUser.get(r.user_id) ?? 0) + (r.points_balance ?? 0));
  }
  const panelsByUser = new Map<string, number>();
  for (const p of panels ?? []) {
    const uid = (p as { user_id: string }).user_id;
    panelsByUser.set(uid, (panelsByUser.get(uid) ?? 0) + 1);
  }
  // Latest check-in per user (by date).
  const lastCheckin = new Map<string, { date: string; streak: number }>();
  for (const c of checkins ?? []) {
    const r = c as { user_id: string; checkin_date: string; streak_count: number };
    const cur = lastCheckin.get(r.user_id);
    if (!cur || r.checkin_date > cur.date) {
      lastCheckin.set(r.user_id, { date: r.checkin_date, streak: r.streak_count });
    }
  }

  const onboardedIds = new Set((profiles ?? []).map((p) => (p as { user_id: string }).user_id));

  const roster = (users ?? []).map((u) => {
    const last = lastCheckin.get(u.id);
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      deleted: u.deleted_at != null,
      access_status: u.access_status,
      onboarded: onboardedIds.has(u.id),
      referral_code: u.referral_code ?? null,
      points: pointsByUser.get(u.id) ?? 0,
      panels: panelsByUser.get(u.id) ?? 0,
      last_checkin: last?.date ?? null,
      streak: last?.streak ?? 0,
    };
  });

  return NextResponse.json({ users: roster, count: roster.length });
}

/**
 * PATCH /api/admin/users — one of:
 *   { id, access_status }  approve / re-waitlist a user (the beta gate);
 *   { id, referral_code }  assign a vanity invite code ("FITTR") for
 *                          partners/influencers — normalized, unique-index
 *                          arbitrated (409 when taken).
 */
export async function PATCH(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const id = typeof b.id === "string" ? b.id : null;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = createSupabaseAdmin();

  if (b.referral_code !== undefined) {
    const code = normalizeReferralCode(b.referral_code);
    if (!code) {
      return NextResponse.json(
        { error: "Codes are 3–16 letters/numbers." },
        { status: 400 },
      );
    }
    const { error } = await supabase
      .from("users")
      .update({ referral_code: code })
      .eq("id", id);
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `“${code}” is already taken.` },
          { status: 409 },
        );
      }
      console.error("admin referral-code update failed:", error);
      return NextResponse.json({ error: "Couldn't set code" }, { status: 500 });
    }
    await supabase.from("events").insert({
      user_id: id,
      type: "referral_code_set",
      metadata: { by: admin.email, code },
    });
    return NextResponse.json({ ok: true, code });
  }

  const access_status =
    b.access_status === "approved" || b.access_status === "waitlisted"
      ? b.access_status
      : null;
  if (!access_status) {
    return NextResponse.json(
      { error: "access_status or referral_code required" },
      { status: 400 },
    );
  }

  // Read before writing: whether to send the "you're in" email depends on what
  // the status WAS. A second Approve on an already-approved user is not a new
  // grant, and must not mail them again.
  const { data: before } = await supabase
    .from("users")
    .select("email, access_status, access_granted_email_at")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("users")
    .update({
      access_status,
      // Revoking access clears the stamp, so that if this person is approved
      // again later they are told again — while still never getting two emails
      // for one grant.
      ...(access_status === "waitlisted" ? { access_granted_email_at: null } : {}),
    })
    .eq("id", id);
  if (error) {
    console.error("admin access update failed:", error);
    return NextResponse.json({ error: "Couldn't update access" }, { status: 500 });
  }
  // Audit trail in the event stream.
  await supabase.from("events").insert({
    user_id: id,
    type: access_status === "approved" ? "beta_approved" : "beta_waitlisted",
    metadata: { by: admin.email },
  });

  const emailed = await maybeSendAccessEmail(id, {
    email: (before?.email as string) ?? null,
    previousStatus: (before?.access_status as string) ?? null,
    nextStatus: access_status,
    alreadySentAt: (before?.access_granted_email_at as string) ?? null,
  });

  // The approval has already succeeded and been audited by this point. The
  // email result rides along so the admin UI can say "approved, emailed" or
  // "approved, email failed" — but it can never turn a successful approval
  // into a failed request.
  return NextResponse.json({ ok: true, emailed });
}

/**
 * Send the "you're in" mail, if this is genuinely a new grant.
 *
 * Returns what happened rather than throwing. Nothing about approving a user
 * is allowed to depend on an outbound HTTP call to a third party succeeding.
 */
async function maybeSendAccessEmail(
  userId: string,
  args: {
    email: string | null;
    previousStatus: string | null;
    nextStatus: string;
    alreadySentAt: string | null;
  },
): Promise<"sent" | "skipped" | "failed"> {
  if (!args.email) return "skipped";
  if (
    !shouldSendAccessEmail({
      previousStatus: args.previousStatus,
      nextStatus: args.nextStatus,
      alreadySentAt: args.alreadySentAt,
    })
  ) {
    return "skipped";
  }

  const supabase = createSupabaseAdmin();
  // The greeting is nicer with a name and fine without one, so a missing
  // profile is not worth failing over.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", userId)
    .eq("relationship", "self")
    .maybeSingle();

  const result = await sendEmail(
    accessGrantedEmail({ to: args.email, fullName: (profile?.full_name as string) ?? null }),
  );

  if (!result.sent) {
    // "not_configured" is the expected state before the domain is verified,
    // and is not an error worth recording as one.
    if (result.reason !== "not_configured") {
      console.error("access-granted email failed:", result.reason, result.detail ?? "");
      await supabase.from("events").insert({
        user_id: userId,
        type: "access_email_failed",
        metadata: { reason: result.reason, detail: result.detail ?? null },
      });
      return "failed";
    }
    return "skipped";
  }

  // Stamped only after Resend has accepted it. Stamping first would mean a
  // failed send permanently marks the user as told.
  await supabase
    .from("users")
    .update({ access_granted_email_at: new Date().toISOString() })
    .eq("id", userId);

  await supabase.from("events").insert({
    user_id: userId,
    type: "access_email_sent",
    metadata: { provider: "resend", id: result.id },
  });

  return "sent";
}
