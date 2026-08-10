import { OTHER_TYPE, type ExerciseType } from "@/lib/exercises";

/**
 * The activity icon set, inlined.
 *
 * WHY NOT `lucide-react`. The handoff says to import from it and says it is
 * "already in the app". It is not: nothing in `package.json` depends on it, and
 * this app deploys to a Cloudflare Worker where bundle size is a real
 * constraint. Adding an icon library to draw nine glyphs would pull a package
 * to reach the same pixels these forty lines already reach.
 *
 * These ARE the handoff's icons, taken from the paths shipped in its
 * `assets/icons/*.svg`, at its stroke width and cap style. If a tenth glyph is
 * needed and the set starts growing, that is the moment to revisit the
 * dependency, not now.
 *
 * `currentColor`, so a tile decides the colour and this file never has to know
 * about selected states.
 */

/** One path per glyph, in the order they appear on the check-in grid. */
const PATHS: Record<string, string[]> = {
  walking: [
    "M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z",
    "M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z",
    "M16 17h4",
    "M4 13h4",
  ],
  running: ["M10 2h4", "M12 14l3-3", "M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"],
  cycling: [
    "M5.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
    "M18.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
    "M12 17.5V14l-3-3 4-3 2 3h2",
    "M15 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  ],
  swimming: [
    "M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
    "M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
    "M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
  ],
  gym: [
    "M14.4 14.4 9.6 9.6",
    "M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z",
    "m21.5 21.5-1.4-1.4",
    "M3.9 3.9 2.5 2.5",
    "M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z",
  ],
  /*
   * A LIFTER, NOT A FLAME. The flame from the icon set is the "calories burned"
   * glyph and says nothing about what CrossFit is; beside a dumbbell for Gym it
   * read as a second, vaguer intensity marker. This is an overhead press: bar,
   * plates, arms, figure. Drawn here rather than taken from the set, which has
   * no lifter in it.
   */
  crossfit: [
    "M3 3h18",
    "M6 1.5v3",
    "M18 1.5v3",
    "M9 11V3",
    "M15 11V3",
    "M10 12.5a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
    "M12 14.5V17",
    "m12 17-3 5",
    "m12 17 3 5",
  ],
  /*
   * A FORWARD FOLD, NOT A SPARKLE. The sparkle is the set's "magic" glyph and
   * was doing no work here beyond looking calm. This is the silhouette anybody
   * recognises as stretching: legs out, torso folded over them, arms reaching
   * for the foot.
   */
  yoga_mobility: [
    "M5 19h12",
    "M17 19v-3.5",
    "M9.5 8.5a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
    "m6 19 4.5-8.5",
    "m10.5 10.5 6 5.5",
  ],
  hiking: ["m8 3 4 8 5-5 5 15H2L8 3z"],

  /*
   * THE FIVE THE HANDOFF'S SET HAD NO GLYPH FOR.
   *
   * They were left blank when the tiles shipped, which was the honest thing to
   * do at the time: a dumbbell beside "Racquet & team sports" is worse than
   * empty space. It is not the right thing to leave, because those five are as
   * selectable as the other eight and a tile without an icon reads as one that
   * failed to load. Drawn at the same 1.7 stroke as the rest.
   */
  functional: ["M13 2 3 14h9l-1 8 10-12h-9l1-8z"],
  hyrox: [
    "M22 12h-2.5l-2.5 8-5-16-2.5 8H7",
    "M5 12H2",
  ],
  gymnastics: [
    "M7 3v5",
    "M17 3v5",
    "M4 14a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
    "M14 14a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
    "M10 14h4",
  ],
  sports: [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
    "M5.6 5.6c3.2 3.2 3.2 9.6 0 12.8",
    "M18.4 5.6c-3.2 3.2-3.2 9.6 0 12.8",
  ],
  boxing: [
    "M7 9a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4z",
    "M7 10.5H5.5a1.5 1.5 0 0 0 0 3H7",
    "M9 17v2a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2",
  ],
  [OTHER_TYPE]: ["M12 5v14", "M5 12h14"],
};

/**
 * Every type in the taxonomy has a glyph now.
 *
 * Five of them (functional, hyrox, gymnastics, sports, boxing) had none when
 * the tiles shipped, because the handoff's set does not contain them and
 * borrowing a neighbour's would have put a dumbbell beside "Racquet & team
 * sports". Drawing them was the answer; leaving them blank made a real,
 * selectable tile look like one whose image failed to load.
 *
 * The guard stays: an unknown key still renders nothing rather than a wrong
 * picture, which is what happens if a type is added to `exercises.ts` and
 * forgotten here.
 */
export function ActivityIcon({
  type,
  size = 26,
  className = "",
}: {
  type: ExerciseType | typeof OTHER_TYPE | string;
  size?: number;
  className?: string;
}) {
  const paths = PATHS[type];
  if (!paths) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The tick inside a selected tile's badge. Stroke 3, per the handoff. */
export function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
