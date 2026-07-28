"use client";

import { rankProgress, visibleRanks, type Rank } from "@/lib/iki-rank";
import { RANK_ART, rankChipSvg, rankPinSvg, svgDataUri } from "@/lib/rank-pin";
import { Card, Eyebrow } from "./ui";

/**
 * The Iki rank badge, to Claude Design's "Iki Badges v3".
 *
 * SIZE PICKS THE ARTWORK, and that is a rule from the spec rather than a
 * preference: the full pin's scene turns to mud below about 120px, where a
 * muddy pin reads as a rendering bug rather than a small badge. So the rank
 * card, the ladder and any list row use the chip — rim, band, kanji — and the
 * full pin appears only at hero size: the level-up moment and the share card.
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
        <span className="font-label text-[0.6rem] uppercase tracking-[0.2em] text-muted">
          {rank.name}
        </span>
      )}
    </span>
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
        <span className="font-label text-[0.6rem] uppercase tracking-[0.2em] text-muted">
          {rank.name}
        </span>
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <RankChip rank={rank} size={56} />
          <div className="flex flex-col gap-0.5">
            <Eyebrow>Your rank</Eyebrow>
            <p className="font-display text-2xl font-medium text-foreground">{rank.name}</p>
            <p className="font-label text-[0.55rem] uppercase tracking-[0.24em] text-accent">
              {rank.kanji} · {rank.scene}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-medium text-foreground">
            {score.toLocaleString()}
          </p>
          <p className="font-label text-[0.55rem] uppercase tracking-[0.18em] text-muted">
            iki score
          </p>
        </div>
      </div>

      <p className="font-body text-xs text-muted">{rank.blurb}</p>

      {next ? (
        <div className="flex flex-col gap-2">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuenow={Math.round(fraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progress to ${next.name}`}
          >
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          <p className="font-body text-xs text-muted">
            {remaining.toLocaleString()} to {next.name}
          </p>
        </div>
      ) : nextIsSecret ? (
        // Deliberately vague. Naming the rank or its threshold here would give
        // away the surprise to exactly the people about to reach it.
        <p className="font-body text-xs text-accent">
          You&rsquo;re at the top of the ladder. Word is there&rsquo;s something
          past it.
        </p>
      ) : (
        <p className="font-body text-xs text-accent">
          Top rank. There is nothing above this.
        </p>
      )}

      <RankLadder score={score} current={rank} />

      {onShare && (
        <button
          type="button"
          onClick={onShare}
          className="rounded-pill border border-border px-4 py-2 font-label text-[0.65rem] uppercase tracking-[0.2em] text-foreground transition-colors hover:border-accent hover:text-accent"
        >
          Share your rank
        </button>
      )}
    </Card>
  );
}

/**
 * The case: one well per rank, filled as it is earned.
 *
 * Four wells until Grandmaster is reached — `visibleRanks` withholds the fifth,
 * so the row itself never hints that a fifth exists.
 */
export function RankLadder({ score, current }: { score: number; current: Rank }) {
  const ranks = visibleRanks(score);
  return (
    <ol className="flex items-center justify-between gap-2 border-t border-border pt-4">
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
              className={`font-label text-[0.5rem] uppercase tracking-[0.14em] ${
                isCurrent ? "text-accent" : "text-muted/70"
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
 * The level-up moment — the one place the full pin appears in-app.
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
          <img
            src={svgDataUri(rankPinSvg(rank.id, rank.name, { ringText: true }))}
            alt=""
            width={96}
            height={96}
            className="shrink-0"
          />
          <div className="flex flex-col gap-1">
            <p className="font-label text-[0.6rem] uppercase tracking-[0.28em] text-accent">
              New rank
            </p>
            <p className="font-display text-2xl font-medium text-foreground">{rank.name}</p>
            <p className="font-body text-sm text-muted">{rank.blurb}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="px-2 font-body text-lg leading-none text-muted"
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2">
        {onShare && (
          <button
            type="button"
            onClick={onShare}
            className="rounded-pill bg-accent px-4 py-2 font-label text-[0.65rem] uppercase tracking-[0.2em] text-white"
          >
            Share it
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-pill px-3 py-2 font-label text-[0.65rem] uppercase tracking-[0.2em] text-muted"
        >
          Later
        </button>
      </div>
    </div>
  );
}
