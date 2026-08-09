"use client";

/**
 * A switch.
 *
 * WHY ITS OWN FILE. It started life inside the check-in controls and now also
 * carries the daily reminder on Profile. A general control imported out of a
 * module named for one screen is a lie about where it belongs, and the next
 * screen that needs one would either import from "checkin-controls" or grow a
 * second copy.
 *
 * `role="switch"` on a real button, so it is reachable, toggles on Space and
 * Enter for free, and announces its state. The selected styling hangs off the
 * same `aria-checked` in CSS, so what is seen and what is announced cannot
 * drift apart. The knob's travel is computed from the track's own tokens rather
 * than a second hardcoded offset, so resizing the switch in `globals.css`
 * cannot leave the knob short of the end.
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
