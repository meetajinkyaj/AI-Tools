"use client";

import { useCallback, useRef } from "react";

import { ENERGY_LABELS, MAX_ENERGY, MIN_ENERGY } from "@/lib/checkin";
import {
  DURATION_BUCKETS,
  DURATION_HINTS,
  DURATION_LABELS,
  type DurationBucket,
} from "@/lib/exercises";
import { ActivityIcon, CheckIcon } from "./activity-icon";

/**
 * The four controls the check-in mockup specifies as behaviour rather than as
 * paint. They live here rather than inside `checkin-form.tsx` because each one
 * carries real interaction logic, and a 600 line form with four gesture
 * handlers threaded through it is a file nobody can read.
 *
 * None of them owns any state. Every one takes a value and an onChange, so the
 * form remains the single place a check-in exists.
 */

const ENERGY_VALUES = Array.from(
  { length: MAX_ENERGY - MIN_ENERGY + 1 },
  (_, i) => MIN_ENERGY + i,
);

/**
 * The value a fraction across the track maps to.
 *
 * EXPORTED SO IT CAN BE TESTED WITHOUT A DOM. This is the one piece of
 * arithmetic in the drag that can be subtly wrong: the boundaries between
 * cells, and what happens when a finger travels past either end. Everything
 * else in the gesture is the browser's pointer capture doing its job.
 *
 * Floor rather than round, because the cells are equal slices: the first fifth
 * of the track is cell one, all of it, not the half either side of its centre.
 */
export function energyAtRatio(ratio: number): number {
  const span = MAX_ENERGY - MIN_ENERGY + 1;
  const index = Math.floor(ratio * span);
  return Math.min(MAX_ENERGY, Math.max(MIN_ENERGY, MIN_ENERGY + index));
}

/**
 * Energy, as one slider you can drag across.
 *
 * WHY NOT FIVE BUTTONS, which is what it was. Five buttons is five tab stops
 * and, to a screen reader, a toolbar; what this actually is, is one value
 * between one and five. So the track is a single `role="slider"` with one tab
 * stop, its aria values, and an `aria-valuetext` carrying the word rather than
 * the number, because "Good" is the thing being chosen and "4" is how we store
 * it.
 *
 * THE DRAG IS THE POINT. Pointer capture on the track means the gesture keeps
 * following the finger after it leaves the element, which is what makes a slide
 * feel like a slide rather than like five taps that sometimes miss. The value
 * comes from the x position rather than from which cell was hit, so dragging
 * past the end pins to 5 instead of stopping wherever the last cell happened to
 * be.
 *
 * Keyboard: arrows move by one, Home and End jump to the ends. A slider that
 * only works with a pointer is not a slider.
 */
export function EnergyScale({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  /** The value under a given client x, clamped to the scale. */
  const valueAt = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return MIN_ENERGY;
    const { left, width } = el.getBoundingClientRect();
    if (width === 0) return MIN_ENERGY;
    return energyAtRatio((clientX - left) / width);
  }, []);

  const commit = useCallback(
    (clientX: number) => {
      const next = valueAt(clientX);
      if (next !== value) onChange(next);
    },
    [valueAt, value, onChange],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Energy"
        aria-valuemin={MIN_ENERGY}
        aria-valuemax={MAX_ENERGY}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value ? ENERGY_LABELS[value] : "Not set"}
        className="iki-energy"
        onPointerDown={(e) => {
          draggingRef.current = true;
          // Capture on the TRACK, so a finger that slides off the row still
          // drives the value instead of the gesture being lost to the page.
          e.currentTarget.setPointerCapture(e.pointerId);
          commit(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) commit(e.clientX);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
        onKeyDown={(e) => {
          const current = value ?? MIN_ENERGY - 1;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            onChange(Math.min(MAX_ENERGY, current + 1));
          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(Math.max(MIN_ENERGY, current - 1));
          } else if (e.key === "Home") {
            e.preventDefault();
            onChange(MIN_ENERGY);
          } else if (e.key === "End") {
            e.preventDefault();
            onChange(MAX_ENERGY);
          }
        }}
      >
        {ENERGY_VALUES.map((v) => (
          <div
            key={v}
            // Filled UP TO the value, not only at it, so the row reads as a
            // level rather than as five radio buttons.
            data-filled={value !== null && v <= value}
            data-active={value === v}
            className="iki-energy-cell"
            aria-hidden
          >
            {v}
          </div>
        ))}
      </div>
      <span className="text-small text-muted">
        {value ? `${ENERGY_LABELS[value]}, press and slide` : "Press and slide"}
      </span>
    </div>
  );
}

/**
 * The "I trained today" switch.
 *
 * `role="switch"` on a real button, so it is reachable, toggles on Space and
 * Enter for free, and announces its state. The knob's travel is computed from
 * the track's own tokens rather than a second hardcoded offset, so changing the
 * switch's size in `globals.css` cannot leave the knob short of the end.
 */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="iki-switch"
    >
      <span className="iki-switch-knob" />
    </button>
  );
}

/**
 * One activity, as a tile.
 *
 * `aria-pressed` rather than a checkbox: this is a toggle button, and the
 * selected styling hangs off that same attribute in CSS, so the visible state
 * and the announced state cannot drift apart.
 *
 * The icon is decorative. The label is the accessible name, which is why the
 * glyph is `aria-hidden` and a missing glyph costs nothing.
 */
export function ActivityTile({
  type,
  label,
  selected,
  onToggle,
}: {
  type: string;
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onToggle} className="iki-tile">
      <span className="iki-tile-label">{label}</span>
      <span className="iki-tile-icon">
        <ActivityIcon type={type} />
      </span>
      {selected && (
        <span className="iki-tile-check">
          <CheckIcon />
        </span>
      )}
    </button>
  );
}

/**
 * How long, as a segmented control with one pill that travels.
 *
 * THE PILL IS A SINGLE ELEMENT that animates its `left` between the three
 * slots, never two pills cross-fading. The movement is the feedback: you can
 * see which option you came from, and on a control whose three choices differ
 * only by a word, that is most of what tells you something changed.
 *
 * Its geometry is inline because it is arithmetic on the track's own width.
 * The track has 4px of padding either side, so each slot is a third of what is
 * left, and the pill's offset is the padding plus that slot times its index.
 *
 * `role="radiogroup"` with `aria-checked` options, because the three are
 * mutually exclusive and one of them can be none: tapping the selected option
 * clears it, which the form already allowed and which the pill expresses by
 * fading to nothing rather than sliding somewhere arbitrary.
 */
export function DurationSegmented({
  value,
  onChange,
  label,
}: {
  value: DurationBucket | null;
  onChange: (b: DurationBucket) => void;
  label: string;
}) {
  const index = value ? DURATION_BUCKETS.indexOf(value) : -1;
  // The track carries 4px of padding on each side, so the three slots share
  // what is left of its width. Written out rather than measured, because a
  // resize observer to place a pill would be four times the code and one more
  // thing to get wrong on the first paint.
  const PAD = 4;
  const slot = `((100% - ${PAD * 2}px) / ${DURATION_BUCKETS.length})`;

  return (
    <div role="radiogroup" aria-label={label} className="iki-segmented">
      <span
        className="iki-segmented-pill"
        style={{
          width: `calc(${slot})`,
          left: `calc(${PAD}px + ${index < 0 ? 0 : index} * ${slot})`,
          opacity: index < 0 ? 0 : 1,
        }}
        aria-hidden
      />
      {DURATION_BUCKETS.map((b) => (
        <button
          key={b}
          type="button"
          role="radio"
          aria-checked={value === b}
          onClick={() => onChange(b)}
          className="iki-segmented-option"
        >
          <span>{DURATION_LABELS[b]}</span>
          <span className="iki-segmented-sub">{DURATION_HINTS[b]}</span>
        </button>
      ))}
    </div>
  );
}
