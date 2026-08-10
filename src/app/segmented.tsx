"use client";

/**
 * A segmented control: n options, one pill that travels between them.
 *
 * THE PILL IS A SINGLE ELEMENT that animates its `left`, never two pills
 * cross-fading. The movement is the feedback: you can see which option you came
 * from, and on a control whose choices differ only by a word, that is most of
 * what tells you something changed.
 *
 * Its width and offset are inline because they are arithmetic on the track's
 * own width. Written out rather than measured: a resize observer to place a
 * pill would be four times the code and one more thing to get wrong on the
 * first paint.
 *
 * `value === null` is a real state and the pill fades out for it, rather than
 * sliding somewhere arbitrary. The duration control needs it, because tapping
 * the selected option clears it.
 *
 * GENERALISED FROM THE DURATION CONTROL when the theme switcher needed the same
 * thing. Three options of "System / Light / Dark" and three of "Short / Medium
 * / Long" are one component with different labels, and the alternative was a
 * second copy of the pill arithmetic.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** The smaller line under the label, if the option needs one. */
  sub?: string;
}

/** The track's padding, in px. The pill's geometry is computed from it. */
const PAD = 4;

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly SegmentedOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
}) {
  const index = value ? options.findIndex((o) => o.value === value) : -1;
  const slot = `((100% - ${PAD * 2}px) / ${options.length})`;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="iki-segmented"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      <span
        className="iki-segmented-pill"
        style={{
          width: `calc(${slot})`,
          left: `calc(${PAD}px + ${index < 0 ? 0 : index} * ${slot})`,
          opacity: index < 0 ? 0 : 1,
        }}
        aria-hidden
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className="iki-segmented-option"
        >
          <span>{o.label}</span>
          {o.sub && <span className="iki-segmented-sub">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}
