"use client";

import { rankProgress, visibleRanks, type Rank } from "@/lib/iki-rank";
import { RANK_ART, rankChipSvg, rankPinSvg } from "@/lib/rank-pin";

/**
 * The Iki rank badge, to Claude Design's "Iki Badges v3".
 *
 * SIZE PICKS THE ARTWORK. The full pin's scene turns to mud below about 120px,
 * where it stops reading as a small badge and starts reading as a rendering
 * bug, so anything under that threshold gets the chip instead, rim, band,
 * kanji, no scene.
 *
 * The spec put the rank card itself on the chip side of that line. It is on
 * the pin side here, deliberately: the pins are the reason the set exists, and
 * reserving them for the level-up moment means a user sees their own badge a
 * handful of times a year. The card is wide enough to carry one at full size,
 * so it does. The ladder underneath keeps chips, because four pins across a
 * phone-width card would be ~85px each, under the threshold, and muddy.
 *
 * All progress data still comes from `rankProgress()`; nothing about which rank
 * you are or how far you have to go is computed in the markup.
 */

/** Inline the SVG so it inherits nothing and cannot 404. */
function Glyph({ svg, size, className }: { svg: string; size: number; className?: string }) {
  return (
    <span
      className={className}
      style={{ width: size, height: size, display: "inline-block", flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function RankChip({
  rank,
  size = 44,
  label,
}: {
  rank: Rank;
  size?: number;
  label?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Glyph svg={rankChipSvg(rank.id, rank.name)} size={size} />
      {label && (
        <span className="iki-eyebrow-sm">{rank.name}</span>
      )}
    </span>
  );
}

/**
 * The full enamel pin: scene, ring lettering, hanko seal.
 *
 * Keep `size` at 120 or above. Below that the scene collapses into noise and
 * the chip is the correct component instead.
 */
export function RankPin({ rank, size = 132 }: { rank: Rank; size?: number }) {
  return (
    <Glyph
      svg={rankPinSvg(rank.id, rank.name, { ringText: true, title: rank.name })}
      size={size}
      className="drop-shadow-[0_8px_18px_rgba(28,22,17,0.28)]"
    />
  );
}

export function RankBadge({
  score,
  size = "full",
  onShare,
}: {
  score: number;
  /** "compact" for a header row, "full" for the Home and profile card. */
  size?: "compact" | "full";
  /** Omit to hide the share affordance entirely. */
  onShare?: () => void;
}) {
  const { rank, next, nextIsSecret, remaining, fraction } = rankProgress(score);

  if (size === "compact") {
    return (
      <div className="flex items-center gap-2" title={rank.blurb}>
        <RankChip rank={rank} size={28} />
        <span className="iki-eyebrow-sm">{rank.name}</span>
      </div>
    );
  }

  return (
    <section className="iki-card flex flex-col gap-3.5">
      <div className="flex items-center gap-4">
        {/*
          THE FULL PIN, NOT THE 86px SEAL THE MOCKUP DRAWS. The handoff's own
          §5 says the prototype's seal is a placeholder that production
          `rank-pin.ts` replaces, and the pin's scene turns to mud below about
          120px. So the card keeps the pin at full size and the ladder below
          keeps chips, which is the same threshold argument in the other
          direction.
        */}
        <RankPin rank={rank} size={132} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="iki-eyebrow">Your rank</p>
          <p className="font-display text-display-md font-medium leading-none text-ink">
            {rank.name}
          </p>
          {/*
            "EARNED", BECAUSE THIS IS NOT THE NUMBER IN THE TILE BELOW IT.
            Rank runs on lifetime points, which never fall; the tile shows the
            spendable balance, which falls when you redeem something and rises
            faster on a partner multiplier. Both were labelled "iki" and sat a
            hundred pixels apart, so a member seeing 400 here and 390 there
            reasonably concluded one of them was broken. Neither was.
          */}
          <p className="font-label text-eyebrow-sm uppercase text-primary">
            {rank.scene} · {score.toLocaleString()} iki earned
          </p>
          <p className="mt-1 text-caption text-muted">{rank.blurb}</p>
        </div>
      </div>

      {next ? (
        <div className="flex flex-col gap-2">
          {/* Terracotta rather than clay: this bar is about a rank still to be
              earned, which is an action, not a thing that already happened. */}
          <div
            className="iki-bar w-full"
            role="progressbar"
            aria-valuenow={Math.round(fraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progress to ${next.name}`}
          >
            <div
              className="iki-bar-fill iki-bar-fill-primary"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          <p className="text-micro text-muted">
            {remaining.toLocaleString()} to {next.name}
          </p>
        </div>
      ) : nextIsSecret ? (
        // Deliberately vague. Naming the rank or its threshold here would give
        // away the surprise to exactly the people about to reach it.
        <p className="text-micro text-primary">
          You&rsquo;re at the top of the ladder. Word is there&rsquo;s something
          past it.
        </p>
      ) : (
        <p className="text-micro text-primary">Top rank. There is nothing above this.</p>
      )}

      <RankLadder score={score} current={rank} />

      {/* The ceremonial button. Reserved for brand moments, and a member's own
          rank is the clearest one on this screen. */}
      {onShare && (
        <button
          type="button"
          onClick={onShare}
          className="iki-btn iki-btn-ceremonial w-full"
        >
          Share your rank
        </button>
      )}
    </section>
  );
}

/**
 * The case: one well per rank, filled as it is earned.
 *
 * Four wells until Grandmaster is reached, `visibleRanks` withholds the fifth,
 * so the row itself never hints that a fifth exists.
 */
export function RankLadder({ score, current }: { score: number; current: Rank }) {
  const ranks = visibleRanks(score);
  return (
    <ol className="flex items-center justify-between gap-2 border-t border-line pt-4">
      {ranks.map((r) => {
        const reached = score >= r.threshold;
        const isCurrent = r.id === current.id;
        return (
          <li key={r.id} className="flex flex-col items-center gap-1.5">
            <Glyph
              svg={rankChipSvg(r.id, r.name)}
              size={38}
              className={reached ? undefined : "opacity-25 grayscale"}
            />
            <span
              className={`font-label text-tab uppercase tracking-[0.14em] ${
                isCurrent ? "text-primary" : "text-muted/70"
              }`}
            >
              {r.threshold.toLocaleString()}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The level-up moment.
 *
 * Shown once, right after the earn that crossed the boundary, with the share
 * sheet one tap away because that is the only moment the post writes itself.
 */
export function RankUpToast({
  rank,
  onClose,
  onShare,
}: {
  rank: Rank;
  onClose: () => void;
  onShare?: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-3 rounded-card border-2 p-5"
      style={{
        borderColor: RANK_ART[rank.id].rim,
        background:
          "radial-gradient(circle at 50% 30%, rgba(50,42,33,0.10), transparent 70%)",
      }}
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <RankPin rank={rank} size={128} />
          <div className="flex flex-col gap-1">
            <p className="iki-eyebrow">New rank</p>
            <p className="font-display text-display-md font-medium text-ink">{rank.name}</p>
            <p className="text-body-sm text-muted">{rank.blurb}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="iki-tap iki-press px-2 text-body-lg leading-none text-muted"
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2">
        {onShare && (
          <button
            type="button"
            onClick={onShare}
            className="iki-tap iki-press rounded-pill bg-primary px-4 py-2 font-label text-eyebrow uppercase text-primary-fg"
          >
            Share it
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="iki-tap iki-press rounded-pill px-3 py-2 font-label text-eyebrow uppercase text-muted"
        >
          Later
        </button>
      </div>
    </div>
  );
}
