/**
 * Exercise taxonomy shared by the profile (a user's usual activities) and the
 * daily check-in (what they actually did, with a per-activity duration).
 * Pure and dependency-free. The category map is the signal the "Future You"
 * model reasons over; the UI only ever shows the human labels.
 */

export const EXERCISE_TYPES = [
  "walking",
  "running",
  "cycling",
  "swimming",
  "gym",
  "functional",
  "crossfit",
  "hyrox",
  "gymnastics",
  "sports",
  "yoga_mobility",
  "hiking",
  "boxing",
] as const;

export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  walking: "Walking / Zone 2",
  running: "Running",
  cycling: "Cycling",
  swimming: "Swimming",
  gym: "Gym / Weights",
  functional: "Functional training",
  crossfit: "CrossFit",
  hyrox: "Hyrox",
  gymnastics: "Gymnastics / Calisthenics",
  sports: "Racquet & team sports",
  yoga_mobility: "Yoga / Pilates / Mobility",
  hiking: "Hiking",
  boxing: "Boxing / Martial arts",
};

/** Training-stimulus category per type, consumed by the Future You model. */
export const EXERCISE_CATEGORY: Record<ExerciseType, string> = {
  walking: "low_cardio",
  running: "cardio",
  cycling: "cardio",
  swimming: "cardio",
  gym: "strength",
  functional: "mixed",
  crossfit: "mixed",
  hyrox: "endurance_strength",
  gymnastics: "strength_skill",
  sports: "mixed",
  yoga_mobility: "mobility",
  hiking: "low_cardio",
  boxing: "mixed",
};

/** The special "other" activity, which carries a free-text label. */
export const OTHER_TYPE = "other";

export const DURATION_BUCKETS = ["short", "medium", "long"] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

export const DURATION_LABELS: Record<DurationBucket, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
};

export const DURATION_HINTS: Record<DurationBucket, string> = {
  short: "<30m",
  medium: "30-60m",
  long: "60m+",
};

/** Representative minutes per bucket, so the model gets a usable volume signal. */
export const DURATION_MINUTES: Record<DurationBucket, number> = {
  short: 20,
  medium: 45,
  long: 75,
};

/** A single logged activity within a check-in. */
export interface ExerciseEntry {
  type: string; // an ExerciseType, or OTHER_TYPE
  label: string | null; // free text, used for "other"
  duration: DurationBucket | null;
}

const MAX_OTHER_LABEL = 60;
const MAX_EXERCISES = 15;

export function isExerciseType(v: unknown): v is ExerciseType {
  return typeof v === "string" && (EXERCISE_TYPES as readonly string[]).includes(v);
}

export function isDurationBucket(v: unknown): v is DurationBucket {
  return typeof v === "string" && (DURATION_BUCKETS as readonly string[]).includes(v);
}

/** The stimulus category for any logged type (unknown/other → "other"). */
export function categoryForType(type: string): string {
  return isExerciseType(type) ? EXERCISE_CATEGORY[type] : "other";
}

/**
 * Normalize an untrusted list of profile activity keys: keep only valid types,
 * dedupe, and preserve order. Never throws.
 */
export function normalizeActivities(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (isExerciseType(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Vendor activity names that mean one of our types, longest-specific first.
 *
 * WHY THIS IS NEEDED. Seven vendors disagree about the taxonomy, and the check-in
 * has a seventh. Oura says `weight_training`, Whoop says `Weightlifting`,
 * Fitbit says `Weights` and the user tapped "Gym / Weights". Those are one
 * activity, and the Training card showed them as separate chips until this
 * existed: somebody who logs a session AND wears a ring saw their single gym
 * hour listed twice, under two names, which is the same double-count the load
 * arithmetic works hard to avoid.
 *
 * MATCHED ON SUBSTRINGS, and the ORDER MATTERS. "gymnastics" contains "gym",
 * so gymnastics is tested first; the same trap waits for anything sharing a
 * stem. Add new entries above the broader ones, not at the end.
 *
 * NO MATCH IS A FINE ANSWER. "Rowing" and "Elliptical" are neither in our
 * taxonomy nor close to it, and they keep the vendor's own word rather than
 * being forced into a category that would misdescribe them.
 */
const VENDOR_ACTIVITY_KEYWORDS: readonly (readonly [ExerciseType, readonly string[]])[] = [
  ["crossfit", ["crossfit"]],
  ["hyrox", ["hyrox"]],
  // Before "gym", which is a substring of "gymnastics".
  ["gymnastics", ["gymnastic", "calisthenic"]],
  ["boxing", ["box", "martial", "karate", "judo", "jiu", "muay", "mma", "wrestl"]],
  ["yoga_mobility", ["yoga", "pilates", "mobility", "stretch", "barre"]],
  ["swimming", ["swim"]],
  ["cycling", ["cycl", "bike", "biking", "spinning", "peloton"]],
  ["running", ["run", "jog", "treadmill", "sprint"]],
  ["hiking", ["hik", "ruck", "trek", "trail"]],
  ["walking", ["walk"]],
  ["gym", ["weight", "strength", "resistance", "lifting", "gym"]],
  ["functional", ["functional", "hiit", "circuit", "bootcamp", "interval"]],
  [
    "sports",
    [
      "tennis",
      "padel",
      "squash",
      "badminton",
      "pickleball",
      "basketball",
      "football",
      "soccer",
      "cricket",
      "volleyball",
      "hockey",
      "rugby",
      "baseball",
      "golf",
      "sport",
    ],
  ],
];

/**
 * The type a vendor's free-text activity name means, or null if we cannot tell.
 *
 * Returning null is deliberate and common. Guessing a category for an activity
 * we do not recognise would put a wrong word on the user's screen, which is
 * worse than showing the vendor's.
 */
export function matchExerciseType(raw: string | null | undefined): ExerciseType | null {
  if (typeof raw !== "string") return null;
  // Vendors separate words with spaces, underscores and hyphens, sometimes in
  // the same payload. Flatten them all before matching.
  const s = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!s) return null;
  for (const [type, keywords] of VENDOR_ACTIVITY_KEYWORDS) {
    if (keywords.some((k) => s.includes(k))) return type;
  }
  return null;
}

export type ExercisesResult =
  | { ok: true; value: ExerciseEntry[] }
  | { ok: false; error: string };

/**
 * Validate and normalize an untrusted check-in `exercises` list. Each entry
 * must have a known type (or "other"); label is optional free text (used for
 * "other"); duration is optional. Never throws.
 */
export function validateExercises(input: unknown): ExercisesResult {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: "Invalid exercises" };
  if (input.length > MAX_EXERCISES) {
    return { ok: false, error: "Too many activities logged" };
  }

  const value: ExerciseEntry[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "Invalid activity entry" };
    }
    const e = raw as Record<string, unknown>;
    const type = e.type;
    if (type !== OTHER_TYPE && !isExerciseType(type)) {
      return { ok: false, error: "Unknown activity type" };
    }
    const label =
      typeof e.label === "string" && e.label.trim().length > 0
        ? e.label.trim()
        : null;
    if (label !== null && label.length > MAX_OTHER_LABEL) {
      return { ok: false, error: "Activity label is too long" };
    }
    const duration = isDurationBucket(e.duration) ? e.duration : null;
    value.push({ type: type as string, label, duration });
  }
  return { ok: true, value };
}
