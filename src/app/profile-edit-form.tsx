"use client";

import { useState } from "react";

import {
  ACTIVITY_LEVEL,
  ACTIVITY_LEVEL_LABELS,
  BIOLOGICAL_SEX,
  BIOLOGICAL_SEX_LABELS,
  PRIMARY_GOAL,
  PRIMARY_GOAL_LABELS,
  type ProfileRow,
} from "@/lib/profile";
import {
  fieldClass,
  labelClass,
  PageHeader,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

/**
 * Profile edit screen. Pre-filled from the user's current profile and covers
 * the full editable set — the lean onboarding fields plus the fields deferred
 * from onboarding (known conditions, country, city). Reuses POST /api/profile,
 * which upserts the whole row.
 */
export function ProfileEditForm({
  profile,
  getToken,
  onSaved,
  onCancel,
}: {
  profile: ProfileRow;
  getToken: () => Promise<string | null>;
  onSaved: (profile: ProfileRow) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [dateOfBirth, setDateOfBirth] = useState(profile.date_of_birth);
  const [biologicalSex, setBiologicalSex] = useState(profile.biological_sex);
  const [primaryGoal, setPrimaryGoal] = useState(profile.primary_goal);
  const [activityLevel, setActivityLevel] = useState(profile.activity_level);
  const [knownConditions, setKnownConditions] = useState(
    profile.known_conditions ?? "",
  );
  const [country, setCountry] = useState(profile.country ?? "");
  const [city, setCity] = useState(profile.city ?? "");
  const [marketingConsent, setMarketingConsent] = useState(
    profile.marketing_consent,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("You're not signed in. Please reload and try again.");
        return;
      }

      const res = await fetch("/api/profile", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          full_name: fullName,
          date_of_birth: dateOfBirth,
          biological_sex: biologicalSex,
          primary_goal: primaryGoal,
          activity_level: activityLevel,
          // Preserve the timezone captured at onboarding.
          timezone: profile.timezone,
          marketing_consent: marketingConsent,
          known_conditions: knownConditions,
          country,
          city,
        }),
      });
      const data = (await res.json()) as { profile?: ProfileRow; error?: string };
      if (!res.ok || !data.profile) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      onSaved(data.profile);
    } catch (err) {
      console.error("Profile update failed:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <main className="flex w-full flex-col gap-6">
        <PageHeader
          eyebrow="Profile"
          title="Edit your profile"
          subtitle="Keep your details up to date so we can tailor your health tracking."
        />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className={labelClass}>
            Full name
            <input
              className={fieldClass}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              maxLength={120}
              autoComplete="name"
            />
          </label>

          <label className={labelClass}>
            Date of birth
            <input
              className={fieldClass}
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              required
              max={today}
            />
          </label>

          <label className={labelClass}>
            Gender
            <select
              className={fieldClass}
              value={biologicalSex}
              onChange={(e) => setBiologicalSex(e.target.value as typeof biologicalSex)}
              required
            >
              {BIOLOGICAL_SEX.map((v) => (
                <option key={v} value={v}>
                  {BIOLOGICAL_SEX_LABELS[v]}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass}>
            Primary goal
            <select
              className={fieldClass}
              value={primaryGoal}
              onChange={(e) => setPrimaryGoal(e.target.value as typeof primaryGoal)}
              required
            >
              {PRIMARY_GOAL.map((v) => (
                <option key={v} value={v}>
                  {PRIMARY_GOAL_LABELS[v]}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass}>
            Activity level
            <select
              className={fieldClass}
              value={activityLevel}
              onChange={(e) => setActivityLevel(e.target.value as typeof activityLevel)}
              required
            >
              {ACTIVITY_LEVEL.map((v) => (
                <option key={v} value={v}>
                  {ACTIVITY_LEVEL_LABELS[v]}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass}>
            Known conditions
            <textarea
              className={`${fieldClass} h-auto min-h-24 resize-y py-2`}
              value={knownConditions}
              onChange={(e) => setKnownConditions(e.target.value)}
              maxLength={2000}
              placeholder="Any conditions we should know about (optional)."
            />
          </label>

          <label className={labelClass}>
            Country
            <input
              className={fieldClass}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              maxLength={120}
              autoComplete="country-name"
            />
          </label>

          <label className={labelClass}>
            City
            <input
              className={fieldClass}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={120}
              autoComplete="address-level2"
            />
          </label>

          <label className="flex items-start gap-2.5 font-body text-sm text-muted">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-accent"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
            />
            Email me occasional product tips and updates.
          </label>

          {error && <p className="font-body text-sm text-accent-hover">{error}</p>}

          <div className="mt-2 flex flex-col gap-3 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={submitting}
              className={`${primaryButtonClass} w-full sm:flex-1`}
            >
              {submitting ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className={`${secondaryButtonClass} w-full sm:flex-1`}
            >
              Cancel
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
