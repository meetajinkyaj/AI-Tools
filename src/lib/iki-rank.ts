/**
 * The Iki rank ladder.
 *
 * Rank is driven by `users.iki_score` — the lifetime sum of BASE points, before
 * any multiplier, never reduced by spending. That definition is the whole point:
 *
 *   - Spending doesn't cost you status. Redeeming a voucher shouldn't demote
 *     you, or the reward system punishes the behaviour it exists to reward.
 *   - A partner code can't buy rank. Two people at Iki Sensei did the same
 *     amount of work, whether or not either arrived through a 2x community
 *     code. If the multiplier touched this, the ladder would be meaningless on
 *     the day it launched.
 *
 * THRESHOLDS ARE NOT ARBITRARY. They were fitted to modelled earn rates from
 * the real `POINTS` values, across five usage personas. A committed user
 * (~6x/week check-ins, a panel and two re-tests a year) earns roughly 5,900
 * base points a year, so:
 *
 *   Apprentice  ~1 month     the first milestone should land in week 2–4
 *   Pro         ~5 months    a season of consistency
 *   Sensei      ~14 months   a year of it — the title should mean that
 *   Grandmaster ~4 years     genuinely rare
 *
 * Gaps compound at roughly x5 / x4 / x3 rather than exploding, which keeps the
 * next rung visible from the one below.
 */

export type RankId = "rookie" | "apprentice" | "pro" | "sensei" | "grandmaster";

export interface Rank {
  id: RankId;
  /** Full name, always prefixed "Iki" so currency and status share a vocabulary. */
  name: string;
  /**
   * Kept for text-only surfaces — push notification bodies, the share caption,
   * anywhere a glyph has to survive being copied as a plain string. The badge
   * artwork uses the kanji seal instead; see rank-pin.ts.
   */
  emoji: string;
  /** The rank kanji, stamped in the hanko seal on the pin. */
  kanji: string;
  /**
   * The scene on the pin. The five read as one journey in order — sprout,
   * gate, forge, mountain, and the way past the peak — which is what makes the
   * set feel like chapters rather than five unrelated trophies.
   */
  scene: string;
  /** Minimum lifetime iki score. */
  threshold: number;
  /** Light, slightly cheeky — the tone is "fun, not serious". */
  blurb: string;
  /**
   * Hidden from the ladder until it is reached.
   *
   * Only the top rank is secret. Hiding more would remove the thing that makes
   * a ladder work — being able to see the next rung.
   */
  secret?: boolean;
}

export const RANKS: readonly Rank[] = [
  {
    id: "rookie",
    name: "Iki Rookie",
    emoji: "🌱",
    kanji: "芽",
    scene: "The sprout",
    threshold: 0,
    blurb: "Everything starts as a seed in the sun.",
  },
  {
    id: "apprentice",
    name: "Iki Apprentice",
    emoji: "🛠️",
    kanji: "修",
    scene: "The gate",
    threshold: 400,
    blurb: "The gate is behind you. The path goes on.",
  },
  {
    id: "pro",
    name: "Iki Pro",
    emoji: "⚡",
    kanji: "錬",
    scene: "The forge",
    threshold: 2_000,
    blurb: "Tempered in the fire.",
  },
  {
    id: "sensei",
    name: "Iki Sensei",
    emoji: "🥋",
    kanji: "師",
    scene: "The mountain",
    threshold: 8_000,
    blurb: "The peak is in view.",
  },
  {
    id: "grandmaster",
    name: "Iki Grandmaster",
    emoji: "🏆",
    kanji: "道",
    scene: "The way",
    threshold: 25_000,
    blurb: "Past the peak, joined in gold.",
    secret: true,
  },
] as const;

/* ------------------------------- lookups --------------------------------- */

function safeScore(score: number): number {
  if (!Number.isFinite(score) || score < 0) return 0;
  return Math.floor(score);
}

/** The highest rank whose threshold this score has reached. Never null. */
export function rankFor(score: number): Rank {
  const s = safeScore(score);
  let current: Rank = RANKS[0];
  for (const rank of RANKS) {
    if (s >= rank.threshold) current = rank;
  }
  return current;
}

/** The next rank up, or null at the top. */
export function nextRankAfter(score: number): Rank | null {
  const s = safeScore(score);
  return RANKS.find((r) => s < r.threshold) ?? null;
}

export interface RankProgress {
  rank: Rank;
  /**
   * The next rank, or null at the top — AND null when the next one is secret.
   *
   * A secret rank must not be revealed by the very line that says how far away
   * it is. Naming it there, with its exact threshold, would give the whole
   * thing away to everyone one rung below, which is precisely the population
   * it is meant to surprise.
   */
  next: Rank | null;
  /** True when a next rank exists but is being withheld. */
  nextIsSecret: boolean;
  score: number;
  /** Points still needed for the next rank; 0 at the top or when secret. */
  remaining: number;
  /** 0–1 through the CURRENT band, for a progress bar. 1 at the top. */
  fraction: number;
}

export function rankProgress(score: number): RankProgress {
  const s = safeScore(score);
  const rank = rankFor(s);
  const next = nextRankAfter(s);

  if (!next) {
    return { rank, next: null, nextIsSecret: false, score: s, remaining: 0, fraction: 1 };
  }

  if (next.secret) {
    return { rank, next: null, nextIsSecret: true, score: s, remaining: 0, fraction: 1 };
  }

  const band = next.threshold - rank.threshold;
  const into = s - rank.threshold;
  return {
    rank,
    next,
    nextIsSecret: false,
    score: s,
    remaining: next.threshold - s,
    // Guard the divide: a future edit making two thresholds equal would
    // otherwise produce Infinity and a progress bar that renders as NaN%.
    fraction: band > 0 ? Math.min(1, Math.max(0, into / band)) : 1,
  };
}

/**
 * What the user is allowed to see.
 *
 * The secret rank is withheld until reached — including its name, threshold and
 * blurb — so discovering it is an actual surprise rather than a number someone
 * has been grinding toward for a year.
 */
export function visibleRanks(score: number): Rank[] {
  const s = safeScore(score);
  return RANKS.filter((r) => !r.secret || s >= r.threshold);
}

/**
 * Did this earn cross a rank boundary? Drives the level-up celebration.
 * Returns the new rank, or null if the user stayed put.
 */
export function rankUpCrossed(before: number, after: number): Rank | null {
  const from = rankFor(before);
  const to = rankFor(after);
  return from.id === to.id ? null : to;
}
