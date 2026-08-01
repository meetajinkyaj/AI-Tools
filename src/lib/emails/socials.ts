/**
 * Where to follow us, shared by every email we send.
 *
 * ONE LIST, NOT ONE PER TEMPLATE. A handle that changes, or an account that
 * gets deleted, has to change in exactly one place, or the templates drift
 * and the least-used one ends up pointing somewhere embarrassing.
 *
 * RENDERED AS TEXT LINKS, NEVER ICONS. Icons would need externally hosted
 * images, and mail clients block remote images by default, so the row would
 * arrive as three broken-image boxes for most recipients, worse than no row
 * at all. Remote images are also the standard open-tracking mechanism, and
 * none of our mail should be tracking anyone.
 *
 * AN EMPTY URL IS DROPPED, NOT RENDERED DEAD. An email cannot be corrected
 * after it is sent; a link that 404s sits in someone's inbox permanently. Any
 * entry that is not an absolute https URL simply does not appear.
 */

export interface SocialLink {
  label: string;
  url: string;
}

const SOCIAL_LINKS: SocialLink[] = [
  { label: "Instagram", url: "https://www.instagram.com/ikigaro/" },
  { label: "X", url: "https://x.com/ikigaro_" },
  { label: "LinkedIn", url: "https://www.linkedin.com/company/ikigaro/" },
];

/** Only entries safe to put in an email. */
export function activeSocials(): SocialLink[] {
  return SOCIAL_LINKS.filter((s) => s.url.startsWith("https://"));
}

/** Plain-text block, or an empty array when there is nothing to show. */
export function socialsText(): string[] {
  const socials = activeSocials();
  if (socials.length === 0) return [];
  return ["Follow along:", ...socials.map((s) => `  ${s.label}: ${s.url}`)];
}

/** One muted line of separated links, or "" when there is nothing to show. */
export function socialsHtml(): string {
  const socials = activeSocials();
  if (socials.length === 0) return "";
  const links = socials
    .map(
      (s) => `<a href="${s.url}" style="color:#8a8378;text-decoration:underline;">${s.label}</a>`,
    )
    .join(`<span style="color:#c9c2b6;"> &middot; </span>`);
  return `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#8a8378;">${links}</p>`;
}
