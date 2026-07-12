/**
 * Profile field definitions and validation, shared by the API route and the
 * onboarding form. Pure and dependency-free so it can be unit tested and reused
 * on both client and server.
 */

export const BIOLOGICAL_SEX = ["male", "female", "prefer_not_to_say"] as const;
export const PRIMARY_GOAL = [
  "fat_loss",
  "muscle_gain",
  "hrv",
  "longevity",
  "metabolic_health",
] as const;
export const ACTIVITY_LEVEL = ["sedentary", "light", "moderate", "high"] as const;

export type BiologicalSex = (typeof BIOLOGICAL_SEX)[number];
export type PrimaryGoal = (typeof PRIMARY_GOAL)[number];
export type ActivityLevel = (typeof ACTIVITY_LEVEL)[number];

/** Human-readable labels for the select options (used by the onboarding form). */
export const BIOLOGICAL_SEX_LABELS: Record<BiologicalSex, string> = {
  male: "Male",
  female: "Female",
  prefer_not_to_say: "Prefer not to say",
};

export const PRIMARY_GOAL_LABELS: Record<PrimaryGoal, string> = {
  fat_loss: "Fat loss",
  muscle_gain: "Muscle gain",
  hrv: "Heart-rate variability",
  longevity: "Longevity",
  metabolic_health: "Metabolic health",
};

export const ACTIVITY_LEVEL_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary",
  light: "Lightly active",
  moderate: "Moderately active",
  high: "Highly active",
};

export const ACTIVITY_LEVEL_DESCRIPTIONS: Record<ActivityLevel, string> = {
  sedentary: "Mostly seated, under 5k steps/day.",
  light: "Moving a bit each day, around 5k–7.5k steps/day.",
  moderate: "On your feet often, around 7.5k–10k steps/day.",
  high: "Active most of the day, 10k+ steps/day.",
};

/**
 * The full set of user-editable profile fields.
 *
 * `full_name` through `marketing_consent` make up the "lean" set collected
 * during onboarding; `known_conditions`, `country`, and `city` are deferred
 * from onboarding and captured later on the profile edit screen. All of the
 * deferred fields are optional (nullable), so a lean onboarding body that omits
 * them still validates.
 */
export interface ProfileInput {
  full_name: string;
  date_of_birth: string; // ISO date, YYYY-MM-DD
  biological_sex: BiologicalSex;
  primary_goal: PrimaryGoal;
  activity_level: ActivityLevel;
  timezone: string | null;
  marketing_consent: boolean;
  known_conditions: string | null;
  country: string | null;
  city: string | null;
}

/** A profile row as returned by the API (the DB row shape). */
export interface ProfileRow extends ProfileInput {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export type ValidationResult =
  | { ok: true; value: ProfileInput }
  | { ok: false; error: string };

const MAX_NAME_LENGTH = 120;
const MIN_AGE_YEARS = 13;
const MAX_AGE_YEARS = 120;
const MAX_CONDITIONS_LENGTH = 2000;
const MAX_LOCATION_LENGTH = 120;

/**
 * Validate and normalize an untrusted request body into a ProfileInput.
 * Never throws — returns a discriminated result.
 */
export function validateProfileInput(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const fullName = typeof b.full_name === "string" ? b.full_name.trim() : "";
  if (fullName.length === 0) {
    return { ok: false, error: "Full name is required" };
  }
  if (fullName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "Full name is too long" };
  }

  if (typeof b.date_of_birth !== "string" || !isValidDateOfBirth(b.date_of_birth)) {
    return { ok: false, error: "A valid date of birth is required" };
  }

  if (!isOneOf(b.biological_sex, BIOLOGICAL_SEX)) {
    return { ok: false, error: "Invalid biological sex" };
  }
  if (!isOneOf(b.primary_goal, PRIMARY_GOAL)) {
    return { ok: false, error: "Invalid primary goal" };
  }
  if (!isOneOf(b.activity_level, ACTIVITY_LEVEL)) {
    return { ok: false, error: "Invalid activity level" };
  }

  const timezone = optionalTrimmed(b.timezone);

  const knownConditions = optionalTrimmed(b.known_conditions);
  if (knownConditions !== null && knownConditions.length > MAX_CONDITIONS_LENGTH) {
    return { ok: false, error: "Known conditions is too long" };
  }

  const country = optionalTrimmed(b.country);
  if (country !== null && country.length > MAX_LOCATION_LENGTH) {
    return { ok: false, error: "Country is too long" };
  }

  const city = optionalTrimmed(b.city);
  if (city !== null && city.length > MAX_LOCATION_LENGTH) {
    return { ok: false, error: "City is too long" };
  }

  return {
    ok: true,
    value: {
      full_name: fullName,
      date_of_birth: b.date_of_birth,
      biological_sex: b.biological_sex,
      primary_goal: b.primary_goal,
      activity_level: b.activity_level,
      timezone,
      marketing_consent: b.marketing_consent === true,
      known_conditions: knownConditions,
      country,
      city,
    },
  };
}

/** Trim an untrusted value to a non-empty string, or null when absent/blank. */
function optionalTrimmed(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** Accepts a YYYY-MM-DD date that is a real calendar date and a plausible age. */
export function isValidDateOfBirth(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject impossible dates (e.g. 2023-02-31 rolls over).
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  const now = new Date();
  if (date.getTime() > now.getTime()) {
    return false;
  }
  const age = ageInYears(date, now);
  return age >= MIN_AGE_YEARS && age <= MAX_AGE_YEARS;
}

function ageInYears(birth: Date, now: Date): number {
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
    age--;
  }
  return age;
}
