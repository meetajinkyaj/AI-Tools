import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { emailConfigured, sendEmail } from "@/lib/email";
import {
  broadcastEmail,
  isAudienceId,
  MAX_PER_RUN,
  resolveAudience,
  validateBroadcast,
  type AudienceCandidate,
  type AudienceId,
} from "@/lib/emails/broadcast";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Announcements from the admin console.
 *
 *   GET   /api/admin/broadcasts            history, newest first
 *   GET   /api/admin/broadcasts?audience=… how many this would reach (preview)
 *   POST  /api/admin/broadcasts            { subject, body, audience, test? }
 *   POST  /api/admin/broadcasts            { resume: <id> }
 *
 * THE SHAPE OF THE SEND IS THE SAFETY FEATURE. The recipient list is frozen
 * into `broadcast_recipients` as `pending` rows in one write, and only then
 * does anything go out. That ordering means a crash mid-send leaves an exact
 * record of who was owed the message, and a resume can never re-mail someone
 * already marked `sent`.
 *
 * There is no delete and no edit. An announcement that has gone out cannot be
 * recalled, so pretending otherwise in the API would be a lie.
 */

async function candidates(): Promise<AudienceCandidate[]> {
  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("users")
    .select("id, email, access_status, email_opt_out, deleted_at")
    .limit(5000);
  return (data ?? []) as AudienceCandidate[];
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const audience = new URL(request.url).searchParams.get("audience");

  // Preview: how many people a given audience currently resolves to. Asked for
  // before sending, so the number in the confirmation is the real one.
  if (audience) {
    if (!isAudienceId(audience)) {
      return NextResponse.json({ error: "Unknown audience" }, { status: 400 });
    }
    return NextResponse.json({ count: resolveAudience(audience, await candidates()).length });
  }

  const supabase = createSupabaseAdmin();
  const { data: broadcasts } = await supabase
    .from("broadcasts")
    .select("id, subject, audience, status, created_by, created_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const ids = (broadcasts ?? []).map((b) => b.id as string);
  const { data: recipients } = ids.length
    ? await supabase.from("broadcast_recipients").select("broadcast_id, status").in("broadcast_id", ids)
    : { data: [] };

  const stats = new Map<string, { sent: number; failed: number; pending: number }>();
  for (const r of recipients ?? []) {
    const row = r as { broadcast_id: string; status: string };
    const s = stats.get(row.broadcast_id) ?? { sent: 0, failed: 0, pending: 0 };
    if (row.status === "sent") s.sent += 1;
    else if (row.status === "failed") s.failed += 1;
    else s.pending += 1;
    stats.set(row.broadcast_id, s);
  }

  return NextResponse.json({
    configured: emailConfigured(),
    broadcasts: (broadcasts ?? []).map((b) => ({
      ...b,
      stats: stats.get(b.id as string) ?? { sent: 0, failed: 0, pending: 0 },
    })),
  });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!emailConfigured()) {
    return NextResponse.json({ error: "Email is not configured." }, { status: 400 });
  }

  // Resuming a broadcast that ran out of quota part-way.
  if (typeof body.resume === "string") {
    return resume(body.resume);
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const audience = body.audience;

  const valid = validateBroadcast(subject, text);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
  if (!isAudienceId(audience)) {
    return NextResponse.json({ error: "Pick an audience." }, { status: 400 });
  }

  /**
   * A test send goes to the admin alone and is not recorded as a broadcast.
   *
   * It exists because there is no way to check an email after sending it, and
   * every mistake worth catching — a broken sentence, a subject that reads
   * badly in a list, a paragraph that collapsed — is obvious in an inbox and
   * invisible in a compose box.
   */
  if (body.test === true) {
    const result = await sendEmail(
      broadcastEmail({
        to: admin.email,
        subject: `[TEST] ${subject}`,
        body: text,
        unsubscribeToken: "test-token-not-real",
      }),
    );
    return result.sent
      ? NextResponse.json({ ok: true, test: true })
      : NextResponse.json({ error: `Test send failed: ${result.detail ?? result.reason}` }, { status: 502 });
  }

  const recipients = resolveAudience(audience as AudienceId, await candidates());
  if (recipients.length === 0) {
    return NextResponse.json({ error: "That audience is empty." }, { status: 400 });
  }

  const supabase = createSupabaseAdmin();
  const { data: created, error } = await supabase
    .from("broadcasts")
    .insert({
      subject,
      body: text,
      audience,
      created_by: admin.email,
      status: "sending",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !created) {
    return NextResponse.json({ error: "Couldn't create the broadcast." }, { status: 500 });
  }

  // Freeze the list BEFORE sending anything. If the send dies halfway, this is
  // the record of who was owed the message.
  const { error: recipientError } = await supabase.from("broadcast_recipients").insert(
    recipients.map((r) => ({ broadcast_id: created.id, user_id: r.id, email: r.email })),
  );
  if (recipientError) {
    return NextResponse.json({ error: "Couldn't record recipients." }, { status: 500 });
  }

  return resume(created.id as string);
}

/**
 * Send the pending recipients of one broadcast, up to the per-run cap.
 *
 * Used for both the initial send and an explicit resume — they are the same
 * operation, which is why a partial send is an ordinary state rather than a
 * special case needing its own recovery path.
 */
async function resume(broadcastId: string) {
  const supabase = createSupabaseAdmin();

  const { data: broadcast } = await supabase
    .from("broadcasts")
    .select("id, subject, body")
    .eq("id", broadcastId)
    .maybeSingle();
  if (!broadcast) return NextResponse.json({ error: "Broadcast not found." }, { status: 404 });

  const { data: pending } = await supabase
    .from("broadcast_recipients")
    .select("id, user_id, email")
    .eq("broadcast_id", broadcastId)
    .eq("status", "pending")
    .limit(MAX_PER_RUN);

  const batch = (pending ?? []) as { id: string; user_id: string; email: string }[];

  // Unsubscribe tokens for exactly this batch. Fetched here rather than
  // snapshotted at freeze time so that a token rotated in between is honoured.
  const { data: tokens } = batch.length
    ? await supabase.from("users").select("id, unsubscribe_token").in("id", batch.map((b) => b.user_id))
    : { data: [] };
  const tokenBy = new Map((tokens ?? []).map((t) => [t.id as string, t.unsubscribe_token as string]));

  let sent = 0;
  let failed = 0;

  for (const r of batch) {
    const token = tokenBy.get(r.user_id);
    if (!token) {
      // No token means no unsubscribe link, and an announcement without one is
      // not something we are willing to send.
      await supabase
        .from("broadcast_recipients")
        .update({ status: "failed", error: "no unsubscribe token" })
        .eq("id", r.id);
      failed += 1;
      continue;
    }

    const result = await sendEmail(
      broadcastEmail({
        to: r.email,
        subject: broadcast.subject as string,
        body: broadcast.body as string,
        unsubscribeToken: token,
      }),
    );

    await supabase
      .from("broadcast_recipients")
      .update(
        result.sent
          ? { status: "sent", sent_at: new Date().toISOString(), error: null }
          : { status: "failed", error: result.detail ?? result.reason },
      )
      .eq("id", r.id);

    if (result.sent) sent += 1;
    else failed += 1;
  }

  const { count: stillPending } = await supabase
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .eq("status", "pending");

  const remaining = stillPending ?? 0;
  await supabase
    .from("broadcasts")
    .update(
      remaining === 0
        ? { status: "sent", completed_at: new Date().toISOString() }
        : { status: "sending" },
    )
    .eq("id", broadcastId);

  return NextResponse.json({ ok: true, id: broadcastId, sent, failed, remaining });
}
