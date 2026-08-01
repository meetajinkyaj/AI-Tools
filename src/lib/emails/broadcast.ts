import type { EmailMessage } from "../email";

/**
 * Announcements, composed in the admin console.
 *
 * THE ADMIN TYPES PLAIN TEXT. Not HTML, not markdown. Two reasons, and the
 * second is the important one:
 *
 *   - Mail clients render a small, inconsistent subset of HTML. Anything
 *     ambitious looks broken somewhere, and there is no way to check after
 *     sending.
 *   - Anything typed into that box is interpolated into an HTML document. If
 *     the box accepted HTML, the composer would be an injection vector into
 *     the inbox of every user — pasted content from anywhere could carry
 *     markup nobody reviewed. Escaping everything and building the paragraphs
 *     ourselves means the only HTML that ever ships is HTML we wrote.
 */

function appOrigin(): string {
  return process.env.APP_ORIGIN || "https://app.ikigaro.com";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const MAX_SUBJECT_LENGTH = 120;
export const MAX_BODY_LENGTH = 5000;

/** Blank-line-separated blocks become paragraphs; single newlines become breaks. */
export function bodyToParagraphs(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function unsubscribeUrl(token: string): string {
  return `${appOrigin()}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}

/**
 * Build one recipient's copy of an announcement.
 *
 * The unsubscribe link is per-recipient and NOT optional — see the migration
 * for why the transactional channel depends on it.
 */
export function broadcastEmail(opts: {
  to: string;
  subject: string;
  body: string;
  unsubscribeToken: string;
}): EmailMessage {
  const paragraphs = bodyToParagraphs(opts.body);
  const unsub = unsubscribeUrl(opts.unsubscribeToken);
  const url = appOrigin();

  const text = [
    ...paragraphs,
    // One block, not two entries — the join below puts a blank line between
    // entries, which would split the signature across a paragraph break.
    "— Ajinkya\nIkigaro",
    `Open Ikigaro: ${url}`,
    `You're receiving this because you have an Ikigaro account.\nUnsubscribe from announcements: ${unsub}`,
  ].join("\n\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1b19;">
    <div style="max-width:480px;margin:0 auto;">
      <p style="margin:0 0 24px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8a8378;">Ikigaro</p>

      ${paragraphs
        .map(
          (p) =>
            `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(p).replace(/\n/g, "<br />")}</p>`,
        )
        .join("\n      ")}

      <p style="margin:24px 0 28px;">
        <a href="${url}" style="display:inline-block;padding:12px 24px;background:#1c1b19;color:#faf8f5;text-decoration:none;border-radius:999px;font-size:14px;">Open Ikigaro</a>
      </p>

      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">&mdash; Ajinkya<br />Ikigaro</p>

      <div style="padding-top:16px;border-top:1px solid #e5e0d8;">
        <p style="margin:0;font-size:12px;line-height:1.5;color:#8a8378;">
          You&rsquo;re receiving this because you have an Ikigaro account.<br />
          <a href="${unsub}" style="color:#8a8378;">Unsubscribe from announcements</a>
        </p>
      </div>
    </div>
  </body>
</html>`;

  return { to: opts.to, subject: opts.subject, html, text };
}

/* ------------------------------- audiences -------------------------------- */

export type AudienceId = "approved" | "waitlisted" | "everyone";

export const AUDIENCES: { id: AudienceId; label: string; description: string }[] = [
  { id: "approved", label: "Approved users", description: "Everyone with access to the app." },
  { id: "waitlisted", label: "Waitlist", description: "Signed up, not yet let in." },
  { id: "everyone", label: "Everyone", description: "Approved and waitlisted together." },
];

export function isAudienceId(v: unknown): v is AudienceId {
  return v === "approved" || v === "waitlisted" || v === "everyone";
}

export interface AudienceCandidate {
  id: string;
  email: string | null;
  access_status: string | null;
  email_opt_out: boolean;
  deleted_at: string | null;
}

/**
 * Who actually receives a broadcast.
 *
 * Every exclusion here is one a human would forget under time pressure, which
 * is exactly why it is a pure function with tests rather than a WHERE clause
 * assembled at the call site:
 *
 *   - opted out — the entire point of the opt-out
 *   - deleted   — mailing a deleted account is a data-protection problem, not
 *                 just an embarrassment
 *   - no email  — cannot be sent to
 *
 * Deduplicated by address: two accounts sharing an inbox should not mean the
 * same person receives the announcement twice.
 */
export function resolveAudience(
  audience: AudienceId,
  candidates: AudienceCandidate[],
): AudienceCandidate[] {
  const wanted = (c: AudienceCandidate) =>
    audience === "everyone"
      ? c.access_status === "approved" || c.access_status === "waitlisted"
      : c.access_status === audience;

  const seen = new Set<string>();
  const out: AudienceCandidate[] = [];

  for (const c of candidates) {
    if (!c.email) continue;
    if (c.deleted_at) continue;
    if (c.email_opt_out) continue;
    if (!wanted(c)) continue;

    const key = c.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * How many messages one send request may attempt.
 *
 * Resend's free tier allows 100/day, and a Worker has a hard ceiling on
 * outbound subrequests per invocation. Rather than discovering either limit
 * halfway through a send, a run is capped and the remainder stays `pending`
 * for an explicit Resume. A partially-sent broadcast you can finish is a very
 * different thing from one you have to guess about.
 */
export const MAX_PER_RUN = 50;

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateBroadcast(subject: string, body: string): ValidationResult {
  const s = subject.trim();
  const b = body.trim();
  if (s.length < 3) return { ok: false, error: "Give it a subject." };
  if (s.length > MAX_SUBJECT_LENGTH) {
    return { ok: false, error: `Subject is over ${MAX_SUBJECT_LENGTH} characters.` };
  }
  if (b.length < 10) return { ok: false, error: "The message is too short to send." };
  if (b.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `Message is over ${MAX_BODY_LENGTH} characters.` };
  }
  return { ok: true };
}
