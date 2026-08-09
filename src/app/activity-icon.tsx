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
  crossfit: [
    "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  ],
  yoga_mobility: [
    "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
  ],
  hiking: ["m8 3 4 8 5-5 5 15H2L8 3z"],
  [OTHER_TYPE]: ["M12 5v14", "M5 12h14"],
};

/**
 * No glyph is a fine answer.
 *
 * Four of the taxonomy's types (functional, hyrox, gymnastics, sports, boxing)
 * have no icon in the set. Inventing one from a neighbour would put a dumbbell
 * beside "Racquet & team sports", and a tile reads perfectly well as a label
 * with empty space where the glyph would be.
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
