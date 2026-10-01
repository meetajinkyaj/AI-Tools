"use client";

import { rankProgress, visibleRanks } from "@/lib/iki-rank";
import { RankKanji } from "./data-marks";
import { Sheet } from "./sheet";

/**
 * The rank ladder sheet (UI v2, section 4.2), opened from the rank row on Home.
 *
 * It owns "Share your rank" now that the ladder no longer sits on Home. The
 * ladder shows only the ranks the member is allowed to see: the secret rank
 * stays hidden until reached, exactly as `visibleRanks()` already rules, so
 * this sheet cannot leak its name or threshold.
 *
 * Every name, kanji, scene line and threshold comes from `iki-rank.ts`. The
 * mock's "Iki Adept" and "Iki Master" were placeholders.
 */
export function RankSheet({
  score,
  onShare,
  onClose,
}: {
  /** Lifetime iki earned. */
  score: number;
  onShare: () => void;
  onClose: () => void;
}) {
  const progress = rankProgress(score);
  const { rank } = progress;
  const ladder = visibleRanks(score);
  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <Sheet label="Your rank" onClose={onClose} className="iki-rank-sheet">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <span className="iki-seal iki-seal-lg">
          <span className="iki-seal-inner">
            <RankKanji id={rank.id} size={34} />
          </span>
        </span>
        <p className="iki-eyebrow mt-2">Your rank</p>
        <h2 className="font-display text-display-rank text-ink">{rank.name}</h2>
        <p className="font-label text-eyebrow uppercase tracking-[0.2em] text-primary">
          {rank.scene} · {fmt(score)} iki
        </p>
        <p className="text-caption text-muted">{rank.blurb}</p>
      </div>

      <ol className="mt-2 flex flex-col">
        {ladder.map((r) => {
          const isCurrent = r.id === rank.id;
          const isNext = progress.next?.id === r.id;
          const ahead = score < r.threshold;
          return (
            <li
              key={r.id}
              className={`flex items-center gap-3 border-t border-line py-2.5 ${ahead ? "opacity-55" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="iki-seal iki-seal-sm">
                <RankKanji id={r.id} size={17} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="text-body font-semibold text-ink">{r.name}</span>
                <span className="text-micro text-muted">
                  {isNext ? `${fmt(progress.remaining)} iki away` : r.scene}
                </span>
              </span>
              <span
                className={`shrink-0 font-label text-eyebrow-sm uppercase tracking-[0.14em] tabular-nums ${
                  isCurrent ? "text-primary" : "text-muted"
                }`}
              >
                {isCurrent ? `You · ${fmt(score)}` : fmt(r.threshold)}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-2 flex flex-col gap-1">
        <button type="button" onClick={onShare} className="iki-btn iki-btn-ceremonial iki-btn-ceremonial-primary w-full">
          Share your rank
        </button>
        <button type="button" onClick={onClose} className="iki-btn iki-btn-ceremonial w-full border-0">
          Close
        </button>
      </div>
    </Sheet>
  );
}
