import type { RankId } from "@/lib/iki-rank";
import { KANJI_UNITS_PER_EM, RANK_KANJI_PATH } from "@/lib/rank-kanji";

/**
 * The v2 data marks: progress rings and the rank kanji, as inline SVG.
 *
 * Colours are token names passed in as `var(--...)`, never hex, so a ring
 * follows the ground in dark mode like everything else.
 */

export interface RingSpec {
  /** 0..1. Clamped; NaN draws an empty ring. */
  value: number;
  /** A CSS colour, normally `var(--pillar-...)` or `var(--primary)`. */
  color: string;
}

/**
 * Concentric rings, outermost first, with an optional terracotta centre dot.
 * Arcs start at twelve o'clock and run clockwise.
 */
export function Rings({
  size,
  stroke,
  radii,
  rings,
  centreDot = 0,
  label,
}: {
  size: number;
  stroke: number;
  /** One radius per ring, in the same 0..size space, outermost first. */
  radii: number[];
  rings: RingSpec[];
  /** Radius of the terracotta centre dot, 0 for none. */
  centreDot?: number;
  /** Accessible description. Omit to hide the rings from assistive tech. */
  label?: string;
}) {
  const c = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="shrink-0"
    >
      {rings.map((ring, i) => {
        const r = radii[i];
        const circumference = 2 * Math.PI * r;
        const v = Number.isFinite(ring.value) ? Math.min(1, Math.max(0, ring.value)) : 0;
        return (
          <g key={i} transform={`rotate(-90 ${c} ${c})`}>
            <circle cx={c} cy={c} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
            {v > 0 && (
              <circle
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={ring.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${circumference * v} ${circumference}`}
              />
            )}
          </g>
        );
      })}
      {centreDot > 0 && <circle cx={c} cy={c} r={centreDot} fill="var(--primary)" />}
    </svg>
  );
}

/**
 * A rank kanji at `size` px, in currentColor.
 *
 * Outline paths from `rank-kanji.ts` rather than text, for the reason given
 * there: no CJK webfont, no tofu, identical everywhere. The viewBox centres the
 * glyph optically (baseline at 0, centre 0.36em above it).
 */
export function RankKanji({ id, size }: { id: RankId; size: number }) {
  const em = KANJI_UNITS_PER_EM;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 ${-0.86 * em} ${em} ${em}`}
      fill="currentColor"
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      <path d={RANK_KANJI_PATH[id]} />
    </svg>
  );
}
