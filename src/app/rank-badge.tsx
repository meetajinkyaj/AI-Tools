"use client";

import { rankProgress, visibleRanks, type Rank } from "@/lib/iki-rank";
import { Card, Eyebrow } from "./ui";

/**
 * The Iki rank badge.
 *
 * Deliberately plain for now — real brand styling is coming from Claude Design.
 * What matters here is that the DATA is settled: which rank, how far into the
 * band, what is next, and how many points away. Restyling should not need to
 * move any of that, so all of it comes from `rankProgress()` and none of it is
 * computed in the markup.
 *
 * The secret top rank is filtered by `visibleRanks` and never leaks into the
 * ladder, the progress bar, or the "next rank" copy before it is reached.
 */

export function RankBadge({
  score,
  size = "full",
}: {
  score: number;
  /** "compact" for the home header, "full" for the profile. */
  size?: "compact" | "full";
}) {
  const { rank, next, nextIsSecret, remaining, fraction } = rankProgress(score);

  if (size === "compact") {
    return (
      <div className="flex items-center gap-2" title={rank.blurb}>
        <span aria-hidden className="text-base leading-none">
          {rank.emoji}
        </span>
        <span className="font-label text-[0.6rem] uppercase tracking-[0.2em] text-muted">
          {rank.name}
        </span>
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Eyebrow>Your rank</Eyebrow>
          <p className="font-display text-2xl font-medium text-foreground">
            <span aria-hidden className="mr-2">
              {rank.emoji}
            </span>
            {rank.name}
          </p>
          <p className="font-body text-xs text-muted">{rank.blurb}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-medium text-foreground">{score}</p>
          <p className="font-label text-[0.55rem] uppercase tracking-[0.18em] text-muted">
            iki score
          </p>
        </div>
      </div>

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
            {remaining} to {next.emoji} {next.name}
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
    </Card>
  );
}

/**
 * The ladder, so the next rung is visible from the one below — the thing that
 * makes a ladder work at all.
 */
function RankLadder({ score, current }: { score: number; current: Rank }) {
  const ranks = visibleRanks(score);
  return (
    <ol className="flex flex-col gap-1 border-t border-border pt-3">
      {ranks.map((r) => {
        const reached = score >= r.threshold;
        const isCurrent = r.id === current.id;
        return (
          <li
            key={r.id}
            className={`flex items-center justify-between font-body text-xs ${
              isCurrent ? "text-foreground" : reached ? "text-muted" : "text-muted/60"
            }`}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden>{r.emoji}</span>
              {r.name}
              {isCurrent && (
                <span className="font-label text-[0.5rem] uppercase tracking-[0.16em] text-accent">
                  you
                </span>
              )}
            </span>
            <span className="font-mono text-[0.65rem]">{r.threshold}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The level-up moment. Shown once, right after the check-in that crossed a
 * boundary — the only time it means anything.
 */
export function RankUpToast({ rank, onClose }: { rank: Rank; onClose: () => void }) {
  return (
    <div
      className="flex flex-col gap-2 rounded-card border-2 border-accent bg-accent/10 p-4"
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-label text-[0.6rem] uppercase tracking-[0.28em] text-accent">
            Rank up
          </p>
          <p className="font-display text-xl font-medium text-foreground">
            <span aria-hidden className="mr-2">
              {rank.emoji}
            </span>
            {rank.name}
          </p>
          <p className="font-body text-sm text-muted">{rank.blurb}</p>
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
    </div>
  );
}
