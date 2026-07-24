/**
 * Referral codes — pure logic, shared by the referral API and auth/sync.
 *
 * A code is 8 chars from a confusion-free charset (no 0/O/1/I/L), prefixed
 * "IKI" in the share link's query param for brand feel but stored bare. Codes
 * are generated lazily (first time a user opens the invite card) and are
 * unique per user (DB unique index; generation retries on collision).
 */

/** Unambiguous charset: no 0/O, no 1/I/L — safe to read aloud or retype. */
const CODE_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 8;

/** A fresh random code (not guaranteed unique — the DB index enforces that). */
export function generateReferralCode(
  random: () => number = Math.random,
): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARSET[Math.floor(random() * CODE_CHARSET.length)];
  }
  return code;
}

/**
 * Normalize a user-supplied ref value (query param / pasted) to the stored
 * form: uppercase, charset-only, exact length. Returns null when it can't be
 * a real code — attribution silently skips rather than erroring a signup.
 */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!CODE_CHARSET.includes(ch)) return null;
  }
  return cleaned;
}

/** The shareable invite link for a code. */
export function referralLink(code: string, origin = "https://app.ikigaro.com"): string {
  return `${origin}/?ref=${code}`;
}
