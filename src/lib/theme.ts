/**
 * The colour ground: which one is showing, and how a member chooses.
 *
 * THREE PREFERENCES, TWO GROUNDS. "system" is the default and follows the
 * device, which is what somebody who has set their phone to dark at sunset
 * expects without being asked. "light" and "dark" are overrides for the people
 * whose phone says one thing and whose eyes want another.
 *
 * WHY THE PREFERENCE AND THE GROUND ARE DIFFERENT TYPES. Storing the resolved
 * ground would freeze a "system" member into whichever mode they happened to be
 * in when they first opened the app, and their phone switching at dusk would
 * stop reaching us. The preference is what we keep; the ground is derived on
 * every read.
 *
 * Pure, so the resolution can be tested without a browser. The DOM half lives
 * in `src/app/theme-client.ts`, and the no-flash script in `layout.tsx` inlines
 * the same rules a third time, which is a duplication with a reason: it has to
 * run before any bundle loads.
 */

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** The two grounds `globals.css` actually defines. */
export type Ground = "light" | "dark";

/** Where the choice is kept. Per device, deliberately: a member may want dark
 *  on the phone they check at night and light on the laptop. */
export const THEME_STORAGE_KEY = "ikigaro.theme";

export function isThemePreference(v: unknown): v is ThemePreference {
  return typeof v === "string" && (THEME_PREFERENCES as readonly string[]).includes(v);
}

/**
 * The ground a preference resolves to.
 *
 * `systemPrefersDark` is passed in rather than read here, so this stays pure and
 * so the caller decides what "the system" means: a media query in the browser,
 * and nothing at all on the server.
 */
export function groundFor(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): Ground {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemPrefersDark ? "dark" : "light";
}

/** Anything unrecognised in storage is treated as no choice at all. */
export function readPreference(raw: string | null): ThemePreference {
  return isThemePreference(raw) ? raw : "system";
}

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
