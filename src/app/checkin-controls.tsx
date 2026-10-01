"use client";

import { useCallback, useRef, useState } from "react";

import { ENERGY_LABELS, MAX_ENERGY, MIN_ENERGY } from "@/lib/checkin";
import {
  DURATION_BUCKETS,
  DURATION_HINTS,
  DURATION_LABELS,
  type DurationBucket,
  categoryForType,
} from "@/lib/exercises";
import { ActivityIcon, CheckIcon } from "./activity-icon";
import { Icon } from "./icons";
import { Segmented } from "./segmented";

/**
 * The check-in controls the mockup specifies as behaviour rather than as paint.
 * They live here rather than inside `checkin-form.tsx` because each carries
 * real interaction logic, and a 600 line form with gesture handlers threaded
 * through it is a file nobody can read.
 *
 * The switch used to be here too and now lives in `./switch`, because Profile
 * needs one as well and a general control should not be imported out of a
 * module named for one screen.
 *
 * None of them owns any state. Every one takes a value and an onChange, so the
 * form remains the single place a check-in exists.
 */

/**
 * The value a fraction across the track maps to: the NEAREST of the five stops.
 *
 * EXPORTED SO IT CAN BE TESTED WITHOUT A DOM. This is the one piece of
 * arithmetic in the drag that can be subtly wrong: where one value hands over
 * to the next, and what happens when a finger travels past either end.
 *
 * v2 changed the rule. The v1 control was five cells, so each value owned an
 * equal fifth of the track (floor). The v2 control is a thumb that sits ON a
 * stop at 0, 25, 50, 75 and 100 percent, so the value is whichever stop the
 * finger is closest to (round). Keeping the old rule would put the thumb under
 * the finger's left neighbour for half of every slice.
 */
export function energyAtRatio(ratio: number): number {
  const steps = MAX_ENERGY - MIN_ENERGY;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  return MIN_ENERGY + Math.round(clamped * steps);
}

/** Where the thumb sits for a value, as a percentage across the track. */
export function thumbPercent(value: number): number {
  return ((value - MIN_ENERGY) / (MAX_ENERGY - MIN_ENERGY)) * 100;
}

/**
 * Energy, as one slider you can drag across (v2 section 4.3).
 *
 * ONE SLIDER, NOT FIVE BUTTONS. One tab stop, `role="slider"`, and an
 * `aria-valuetext` carrying the word rather than the number, because "Good" is
 * the thing being chosen and "4" is how we store it.
 *
 * THE DRAG IS THE POINT. Pointer capture on the track keeps following the
 * finger after it leaves the element, and the value comes from the x position,
 * so dragging past the end pins to 5. While dragging the thumb follows with no
 * transition; on release or a key press it glides 120ms to its stop.
 *
 * Keyboard: arrows move by one, Home and End jump to the ends.
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
  const [dragging, setDragging] = useState(false);

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

  const stop = () => {
    draggingRef.current = false;
    setDragging(false);
  };

  return (
    <div className="flex flex-col gap-2">
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
        data-dragging={dragging}
        onPointerDown={(e) => {
          draggingRef.current = true;
          setDragging(true);
          // Capture on the TRACK, so a finger that slides off the row still
          // drives the value instead of the gesture being lost to the page.
          e.currentTarget.setPointerCapture(e.pointerId);
          commit(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) commit(e.clientX);
        }}
        onPointerUp={(e) => {
          stop();
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={stop}
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
        <span className="iki-energy-track" aria-hidden />
        {value != null && (
          <span className="iki-energy-thumb" style={{ left: `${thumbPercent(value)}%` }} aria-hidden>
            <Icon name="flame" size={13} filled strokeWidth={1.5} />
            {value}
          </span>
        )}
      </div>
      <div className="flex justify-between text-micro uppercase tracking-[0.1em] text-muted" aria-hidden>
        <span>{ENERGY_LABELS[MIN_ENERGY]}</span>
        <span>{ENERGY_LABELS[MAX_ENERGY]}</span>
      </div>
    </div>
  );
}

/* --------------------------------- sleep ---------------------------------- */

export const SLEEP_STEP = 0.5;
export const SLEEP_MIN = 0;
export const SLEEP_MAX = 14;
/** Where the first tap on either stepper lands when nothing is logged yet. */
export const SLEEP_START = 7;

/** One stepper tap. Null (not logged) starts at SLEEP_START. */
export function stepSleep(current: number | null, dir: 1 | -1): number {
  if (current == null) return SLEEP_START;
  const next = Math.round((current + dir * SLEEP_STEP) * 2) / 2;
  return Math.min(SLEEP_MAX, Math.max(SLEEP_MIN, next));
}

/**
 * Hours of sleep as two steppers (v2 section 4.3), with a real number input
 * underneath for assistive tech and for typing an exact value.
 *
 * The input is visually hidden but not `hidden`: a screen reader user gets a
 * labelled spin button they can type into, and the steppers are the same edit
 * made with a thumb.
 */
export function SleepStepper({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-display-sleep text-ink" aria-hidden>
        {value ?? "-"}
        <span className="ml-0.5 font-sans text-unit text-muted">h</span>
      </p>
      <label className="sr-only">
        Sleep last night, in hours
        <input
          type="number"
          inputMode="decimal"
          min={SLEEP_MIN}
          max={SLEEP_MAX}
          step={SLEEP_STEP}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      </label>
      <div className="grid grid-cols-2 gap-2" aria-hidden>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onChange(stepSleep(value, -1))}
          disabled={value != null && value <= SLEEP_MIN}
          className="iki-tap iki-press iki-stepper"
        >
          <Icon name="minus" size={16} strokeWidth={2} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onChange(stepSleep(value, 1))}
          disabled={value != null && value >= SLEEP_MAX}
          className="iki-tap iki-press iki-stepper"
        >
          <Icon name="plus" size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------- activities ------------------------------- */

/** The sub line under an unselected tile, from the activity's category. */
const CATEGORY_LABELS: Record<string, string> = {
  low_cardio: "Low intensity",
  cardio: "Cardio",
  strength: "Strength",
  mixed: "Mixed",
  endurance_strength: "Endurance",
  strength_skill: "Skill",
  mobility: "Recovery",
};

/** Mobility work is recovery; everything else is training. */
export function pillarForActivity(type: string): "recovery" | "performance" {
  return categoryForType(type) === "mobility" ? "recovery" : "performance";
}

/**
 * One activity, as a tile (v2 section 4.3).
 *
 * `aria-pressed`, and the selected styling hangs off that same attribute in
 * CSS, so the visible state and the announced state cannot drift apart. The
 * sub line says what the tile needs next: its category when off, the chosen
 * duration when set, and "Set duration" when selected without one.
 */
export function ActivityTile({
  type,
  label,
  selected,
  duration,
  onToggle,
}: {
  type: string;
  label: string;
  selected: boolean;
  duration: DurationBucket | null;
  onToggle: () => void;
}) {
  const pillar = pillarForActivity(type);
  const sub = !selected
    ? (CATEGORY_LABELS[categoryForType(type)] ?? "Activity")
    : duration
      ? `${DURATION_LABELS[duration]} · ${DURATION_HINTS[duration]}`
      : null;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className="iki-tile"
      data-pillar={pillar}
    >
      <span className="iki-tile-well" aria-hidden>
        <ActivityIcon type={type} size={16} />
      </span>
      <span className="iki-tile-label mt-auto">{label}</span>
      <span className={`text-micro ${sub ? "text-muted" : "font-semibold text-primary"}`}>
        {sub ?? "Set duration ↓"}
      </span>
      {selected && (
        <span className="iki-tile-check" aria-hidden>
          <CheckIcon />
        </span>
      )}
    </button>
  );
}

/* --------------------------------- submit --------------------------------- */

/** How long the press has to last, v2 section 5. */
export const HOLD_MS = 600;

/**
 * "Hold to check in" (v2 section 4.3).
 *
 * A press that lasts HOLD_MS fills the ring and then fires; letting go early,
 * or the pointer being cancelled, resets it. The hold is a small ceremony on
 * the one action the app asks for daily, and it makes an accidental tap while
 * scrolling a no-op.
 *
 * THE HOLD IS NEVER THE ONLY WAY IN. Enter and Space fire straight away, and
 * under `prefers-reduced-motion` a plain tap fires, since an animation you have
 * to wait out is exactly what that setting asks us not to impose. The button is
 * a real submit button either way, so the form's own validation still runs.
 */
export function HoldToSubmit({
  label,
  busy,
  onFire,
}: {
  label: string;
  busy: boolean;
  onFire: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };

  const reducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <button
      type="button"
      aria-busy={busy}
      disabled={busy}
      className="iki-hold"
      data-holding={holding}
      onPointerDown={(e) => {
        if (busy || e.button !== 0) return;
        if (reducedMotion()) return; // the click handler fires instead
        setHolding(true);
        timer.current = setTimeout(() => {
          timer.current = null;
          setHolding(false);
          navigator.vibrate?.(10);
          onFire();
        }, HOLD_MS);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onClick={(e) => {
        // detail === 0 is a keyboard activation (Enter or Space): fire now.
        if (e.detail === 0 || reducedMotion()) onFire();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden className="shrink-0">
        <circle cx={12} cy={12} r={10} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={2} />
        <circle
          className="iki-hold-arc"
          cx={12}
          cy={12}
          r={10}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
        />
      </svg>
      {busy ? "Saving…" : label}
    </button>
  );
}

/**
 * How long, as a segmented control.
 *
 * The pill mechanics live in `./segmented`, which the theme switcher also uses.
 * This is the duration vocabulary poured into it: the buckets, their labels and
 * their minute hints, in the order `exercises.ts` declares them.
 *
 * `null` is a real value here. Tapping the selected option clears it, which the
 * form has always allowed, and the pill fades out rather than sliding somewhere
 * arbitrary.
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
  return (
    <Segmented
      label={label}
      value={value}
      onChange={onChange}
      options={DURATION_BUCKETS.map((b) => ({
        value: b,
        label: DURATION_LABELS[b],
        sub: DURATION_HINTS[b],
      }))}
    />
  );
}
