/**
 * Referral codes — pure logic, shared by the referral API, auth/sync, and the
 * admin vanity-code editor.
 *
 * Codes are 3–16 chars of A–Z/0–9 and come in three flavors:
 *   1. Name-based (default): the user's first name — "AJINKYA" — because the
 *      sender shares the link knowingly and a readable code looks trustworthy.
 *      Collisions get a numbered suffix ("AJINKYA2"), arbitrated by the DB's
 *      unique index.
 *   2. Random fallback (8 chars, confusion-free charset) when there's no
 *      usable name.
 *   3. Admin-assigned vanity codes ("FITTR") for partners/influencers.
 */

export const CODE_MIN_LENGTH = 3;
export const CODE_MAX_LENGTH = 16;

/** Unambiguous charset for RANDOM codes: no 0/O, no 1/I/L. */
const RANDOM_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const RANDOM_CODE_LENGTH = 8;

/** A fresh random code (not guaranteed unique — the DB index enforces that). */
export function generateReferralCode(
  random: () => number = Math.random,
): string {
  let code = "";
  for (let i = 0; i < RANDOM_CODE_LENGTH; i++) {
    code += RANDOM_CHARSET[Math.floor(random() * RANDOM_CHARSET.length)];
  }
  return code;
}

/**
 * A name-based code candidate from the user's full name: first name,
 * A–Z/0–9 only, capped at 10 chars; attempt 0 is the bare name, later
 * attempts append a number ("AJINKYA", "AJINKYA2", "AJINKYA3"…).
 * Returns null when the name yields fewer than 3 usable characters —
 * the caller falls back to a random code.
 */
export function nameBasedCode(
  fullName: string | null | undefined,
  attempt = 0,
): string | null {
  if (!fullName) return null;
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  const cleaned = first.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  if (cleaned.length < CODE_MIN_LENGTH) return null;
  return attempt === 0 ? cleaned : `${cleaned}${attempt + 1}`;
}

/**
 * Normalize a code from untrusted input (?ref param, admin vanity editor):
 * uppercase, strip everything outside A–Z/0–9, enforce length bounds.
 * Returns null when it can't be a real code — attribution silently skips
 * rather than erroring a signup.
 */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < CODE_MIN_LENGTH || cleaned.length > CODE_MAX_LENGTH) {
    return null;
  }
  return cleaned;
}

/** The shareable invite link for a code. */
export function referralLink(code: string, origin = "https://app.ikigaro.com"): string {
  return `${origin}/?ref=${code}`;
}
