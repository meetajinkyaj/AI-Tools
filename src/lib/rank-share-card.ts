/**
 * The rank share card. Claude Design's "glory card" from Iki Badges v3.
 *
 * Deliberately much barer than the check-in card. That one has templates,
 * backdrops, and five field toggles because a check-in is a bundle of
 * different facts and people need control over which of them go public. A rank
 * is one fact. There is nothing to choose except where it is going, so the
 * only control is the aspect ratio.
 *
 * WHAT IS ON IT is fixed and safe by construction: rank, iki score, streak.
 * All habit data. No biomarker or health reading can reach this card because
 * none is passed in, the type simply has nowhere to put one.
 */

import { referralLink } from "./referral";
import { INVITE_LINK_ON_SHARED_CARDS } from "./share-card";
import type { RankId } from "./iki-rank";

/* -------------------------------- formats -------------------------------- */

export type RankFormatId = "story" | "post" | "square";

/**
 * Same three ratios as the check-in card, named by where they actually go.
 * Nobody thinks in aspect ratios; they think "this is for my story".
 */
export const RANK_FORMATS: {
  id: RankFormatId;
  name: string;
  where: string;
  w: number;
  h: number;
}[] = [
  { id: "story", name: "Story 9:16", where: "Instagram · WhatsApp", w: 1080, h: 1920 },
  { id: "post", name: "Post 4:5", where: "Instagram feed", w: 1080, h: 1350 },
  { id: "square", name: "Square", where: "LinkedIn · X", w: 1080, h: 1080 },
];

/** The design specifies the 4:5 card, so that is what opens. */
export const DEFAULT_RANK_FORMAT: RankFormatId = "post";

export function rankFormatSize(id: RankFormatId): { w: number; h: number } {
  const f = RANK_FORMATS.find((x) => x.id === id) ?? RANK_FORMATS[1];
  return { w: f.w, h: f.h };
}

/* --------------------------------- data ---------------------------------- */

export interface RankCardInput {
  rankId: RankId;
  rankName: string;
  kanji: string;
  scene: string;
  ikiScore: number;
  streak: number;
  date: Date;
  /** Invite code, or null when the user has not been issued one yet. */
  referralCode: string | null;
}

/** The glory card's palette, from the design document. */
export const RANK_PALETTE = {
  groundInner: "#322A21",
  groundOuter: "#16110D",
  ink: "#FBF9F5",
  accent: "#CD7144",
  rule: "rgba(251,249,245,0.16)",
  faint: "rgba(251,249,245,0.55)",
} as const;

/**
 * "Mon · 26 Jul", the masthead date.
 *
 * Locale-independent on purpose: the card is an image, so a date that renders
 * differently per device makes two people's cards look like different products.
 */
export function rankCardDate(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${days[d.getDay()]} · ${d.getDate()} ${months[d.getMonth()]}`;
}

/**
 * The invite line printed along the card's bottom edge.
 *
 * GATED BY THE SAME CLOSED-BETA FLAG AS THE CHECK-IN CARD, deliberately. That
 * flag exists because access is invite-only: a card advertising a join link
 * sends strangers at a door that will not open, and they leave with the
 * waitlist screen as their impression of the product. A rank card is *more*
 * likely to be posted publicly than a check-in, not less, so exempting it
 * would quietly undo the decision. Flip `INVITE_LINK_ON_SHARED_CARDS` and both
 * cards light up together.
 *
 * THE DESIGN'S VERSION OF THIS LINE IS ALSO WRONG, in the same way the
 * check-in card's once was: it reads "ikigaro.com/join · AJ-47". That path
 * does not exist, and the code carries a hyphen that `cleanReferralInput`
 * strips, so it is not a link any user could hold. The real one comes from
 * `referralLink`, the only thing that produces a URL that resolves.
 *
 * Returns null for "draw nothing", better than a link to a dangling `?ref=`.
 */
export function rankInviteLine(code: string | null): string | null {
  if (!INVITE_LINK_ON_SHARED_CARDS) return null;
  if (!code) return null;
  return referralLink(code).replace(/^https:\/\//, "");
}

/**
 * The caption offered alongside the image.
 *
 * The link is spelled out in full, captions are plain text everywhere that
 * matters, so a URL is only tappable if it is actually written out, and is
 * withheld under the same closed-beta flag as the card's own footer. A caption
 * is if anything more public than the image, since it survives being copied.
 */
export function rankCaption(input: RankCardInput): string {
  const lines = [
    `${input.rankName} on Ikigaro.`,
    `${input.ikiScore.toLocaleString()} iki${
      input.streak > 0 ? ` · ${input.streak} day streak` : ""
    }.`,
  ];
  if (INVITE_LINK_ON_SHARED_CARDS && input.referralCode) {
    lines.push("", `Join me: ${referralLink(input.referralCode)}`);
  }
  return lines.join("\n");
}
