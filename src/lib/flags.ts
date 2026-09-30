/**
 * Feature flags. Plain constants: flipping one is a reviewed code change and a
 * deploy, which is the right amount of ceremony for something members see.
 */

/**
 * The Challenges slot in the bottom bar (UI v2, section 4.0).
 *
 * While false it ships VISIBLE BUT INERT: a dimmed trophy with a "Soon" badge,
 * rendered as a `<span aria-disabled>`, not a button. It has no route, no press
 * state and is never focusable, so a keyboard or screen-reader user does not
 * land on a control that does nothing.
 *
 * Flipping it swaps the span for a real nav button that calls the shell's
 * `onChallenges` prop. Challenges has no screen yet, so turning this on also
 * means adding a "challenges" NavKey and wiring that prop in authed-app.tsx.
 */
export const CHALLENGES_ENABLED = false;
