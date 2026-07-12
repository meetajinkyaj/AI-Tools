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
import { primaryButtonClass, Screen } from "./ui";

const fieldClass =
  "h-11 w-full rounded-lg border border-black/[.12] bg-white px-3 text-sm text-black outline-none focus:border-black/[.4] dark:border-white/[.15] dark:bg-black dark:text-zinc-50 dark:focus:border-white/[.4]";
const labelClass =
  "flex flex-col gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300";

export function OnboardingForm({
  getToken,
  onComplete,
}: {
  getToken: () => Promise<string | null>;
  onComplete: (profile: ProfileRow) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [biologicalSex, setBiologicalSex] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [activityLevel, setActivityLevel] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
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
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;

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
          timezone,
          marketing_consent: marketingConsent,
        }),
      });
      const data = (await res.json()) as { profile?: ProfileRow; error?: string };
      if (!res.ok || !data.profile) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      onComplete(data.profile);
    } catch (err) {
      console.error("Onboarding submit failed:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <main className="flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Tell us about you
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            A few basics so we can tailor your health tracking.
          </p>
        </div>

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
            Biological sex
            <select
              className={fieldClass}
              value={biologicalSex}
              onChange={(e) => setBiologicalSex(e.target.value)}
              required
            >
              <option value="" disabled>
                Select…
              </option>
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
              onChange={(e) => setPrimaryGoal(e.target.value)}
              required
            >
              <option value="" disabled>
                Select…
              </option>
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
              onChange={(e) => setActivityLevel(e.target.value)}
              required
            >
              <option value="" disabled>
                Select…
              </option>
              {ACTIVITY_LEVEL.map((v) => (
                <option key={v} value={v}>
                  {ACTIVITY_LEVEL_LABELS[v]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-start gap-2.5 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
            />
            Email me occasional product tips and updates.
          </label>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`${primaryButtonClass} mt-2 w-full`}
          >
            {submitting ? "Saving…" : "Continue"}
          </button>
        </form>
      </main>
    </Screen>
  );
}
