import type { EmailMessage } from "../email";
import { socialsHtml, socialsText } from "./socials";

/**
 * The "you're in" email — the only mail this product sends today.
 *
 * IT EXISTS BECAUSE THE WAITLIST SCREEN MAKES A PROMISE. It says "when your
 * access opens, this screen becomes the app", which is only true for someone
 * who happens to be looking at it. Without this email, being approved is a
 * silent event and the person discovers it whenever they next wander back —
 * which for most people is never.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   - No invite link and no "bring your friends". The beta is closed on
 *     purpose (see INVITE_LINK_ON_SHARED_CARDS) and the moment someone is let
 *     in is the worst possible moment to ask them to bring strangers.
 *   - No health content of any kind, so no medical disclaimer. This mail says
 *     "your account is open" and nothing else; putting the disclaimer on a
 *     message that carries no health claim is how a disclaimer stops being
 *     read on the messages that do.
 *   - No tracking pixel, no open tracking, no click wrapping.
 */

function appOrigin(): string {
  return process.env.APP_ORIGIN || "https://app.ikigaro.com";
}

/**
 * Escape before interpolating into HTML.
 *
 * The only interpolated value is a user-supplied display name. Someone whose
 * profile name is `<script>` should get an odd-looking email, not a broken one
 * — and mail clients are a genuinely hostile rendering environment.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** First name only, and only if it looks like one. Falls back to no greeting. */
function firstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const first = fullName.trim().split(/\s+/)[0];
  if (!first || first.length > 30) return null;
  return first;
}

export const ACCESS_GRANTED_SUBJECT = "You're in.";

export function accessGrantedEmail(opts: {
  to: string;
  fullName?: string | null;
}): EmailMessage {
  const name = firstName(opts.fullName ?? null);
  const greeting = name ? `Hi ${name},` : "Hi,";
  const url = appOrigin();
  const socialText = socialsText();

  // Plain text is not a fallback nobody reads — it is what keeps this out of
  // spam, and what some clients show by default.
  const text = [
    greeting,
    "",
    "Your Ikigaro access is open. Next time you sign in, the waitlist screen is the app.",
    "",
    "A good first few minutes:",
    "",
    "  1. Do your first daily check-in. It takes under a minute and starts your streak.",
    "  2. Upload a recent blood panel if you have one — that is what Trends and Future You are built on.",
    "",
    `Open Ikigaro: ${url}`,
    "",
    "We are letting people in a few at a time so everyone gets proper attention.",
    "If something is broken or confusing, just reply to this email.",
    "",
    "— Ajinkya",
    "Ikigaro",
    ...(socialText.length > 0 ? ["", ...socialText] : []),
    "",
    "You are receiving this because you joined the Ikigaro private beta.",
  ].join("\n");

  // Inline styles and a table-free layout: mail clients strip <style> blocks,
  // and no external image or font can be relied on to load.
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1b19;">
    <div style="max-width:480px;margin:0 auto;">
      <p style="margin:0 0 24px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8a8378;">Ikigaro</p>

      <h1 style="margin:0 0 16px;font-size:26px;font-weight:500;line-height:1.25;">You&rsquo;re in.</h1>

      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>

      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        Your Ikigaro access is open. Next time you sign in, the waitlist screen is the app.
      </p>

      <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">A good first few minutes:</p>
      <ol style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.7;">
        <li>Do your first daily check-in. It takes under a minute and starts your streak.</li>
        <li>Upload a recent blood panel if you have one &mdash; that&rsquo;s what Trends and Future You are built on.</li>
      </ol>

      <p style="margin:0 0 28px;">
        <a href="${url}" style="display:inline-block;padding:12px 24px;background:#1c1b19;color:#faf8f5;text-decoration:none;border-radius:999px;font-size:14px;">Open Ikigaro</a>
      </p>

      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        We&rsquo;re letting people in a few at a time so everyone gets proper attention.
        If something is broken or confusing, just reply to this email.
      </p>

      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">
        &mdash; Ajinkya<br />Ikigaro
      </p>

      <div style="padding-top:16px;border-top:1px solid #e5e0d8;">
        ${socialsHtml()}
        <p style="margin:0;font-size:12px;line-height:1.5;color:#8a8378;">
          You&rsquo;re receiving this because you joined the Ikigaro private beta.
        </p>
      </div>
    </div>
  </body>
</html>`;

  return {
    to: opts.to,
    subject: ACCESS_GRANTED_SUBJECT,
    html,
    text,
    // A real inbox when configured. "Reply to this email" is a lie if replies
    // bounce, and this is the one message where we most want a reply.
    ...(process.env.EMAIL_REPLY_TO ? { replyTo: process.env.EMAIL_REPLY_TO } : {}),
  };
}

/**
 * Whether approving this user should send the email.
 *
 * Pulled out as a pure function because "send exactly once" is the entire
 * difficulty here, and it should be provable without a database or an API key.
 *
 * Three conditions, all necessary:
 *
 *   - We are granting access, not revoking it.
 *   - Access was not ALREADY granted. Re-saving an approved user, or a
 *     double-clicked Approve button, is not a new grant and must stay silent.
 *   - Nothing has been sent for this grant yet.
 */
export function shouldSendAccessEmail(args: {
  previousStatus: string | null;
  nextStatus: string;
  alreadySentAt: string | null;
}): boolean {
  if (args.nextStatus !== "approved") return false;
  if (args.previousStatus === "approved") return false;
  return args.alreadySentAt === null;
}
