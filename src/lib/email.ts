import "server-only";

/**
 * Sending mail, via Resend's HTTP API.
 *
 * HTTP rather than SMTP because this runs on a Cloudflare Worker, which has no
 * TCP sockets — `nodemailer` and every SMTP library cannot run here at all.
 * Resend's REST endpoint is a plain `fetch`, which is the whole integration.
 *
 * FAILING SOFT IS THE POINT. Every caller is doing something else that matters
 * more than the email: approving a user, marking a launch. If Resend is down,
 * the approval must still land. So this returns a result rather than throwing,
 * and no caller is allowed to make its own success conditional on ours.
 *
 * NOT CONFIGURED IS NOT AN ERROR. Before the domain is verified there is no
 * API key, and the app must run exactly as it does today — approvals work,
 * nothing is sent, nothing is logged as broken. `emailConfigured()` is the
 * switch, and it is off by default.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Who mail comes from. Must be on the domain verified in Resend. */
const DEFAULT_FROM = "Ikigaro <hello@ikigaro.com>";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Both parts, always. See `sendEmail`. */
  html: string;
  text: string;
  /** Where replies go. A real inbox, not a no-reply void. */
  replyTo?: string;
}

export type EmailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not_configured" | "rejected" | "error"; detail?: string };

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || DEFAULT_FROM;
}

/**
 * Send one message.
 *
 * ALWAYS BOTH PARTS. A mail with no plain-text alternative is a strong spam
 * signal, and this product's first ever email landing in spam would cost us the
 * user it was trying to reach. The text part is not a courtesy, it is
 * deliverability.
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "not_configured" };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      }),
    });

    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;

    if (!res.ok) {
      // Logged, never thrown. The caller's real work has already succeeded.
      console.error("resend rejected message:", res.status, body?.message ?? "");
      return { sent: false, reason: "rejected", detail: body?.message ?? `HTTP ${res.status}` };
    }
    return { sent: true, id: body?.id ?? null };
  } catch (err) {
    console.error("resend request failed:", err);
    return { sent: false, reason: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}
