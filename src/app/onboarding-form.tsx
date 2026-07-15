"use client";

import { useState } from "react";

import {
  ACTIVITY_LEVEL,
  ACTIVITY_LEVEL_DESCRIPTIONS,
  ACTIVITY_LEVEL_LABELS,
  BIOLOGICAL_SEX,
  BIOLOGICAL_SEX_LABELS,
  PRIMARY_GOAL,
  PRIMARY_GOAL_LABELS,
  type ProfileRow,
} from "@/lib/profile";
import { ActivityChips } from "./activity-chips";
import {
  fieldClass,
  labelClass,
  PageHeader,
  primaryButtonClass,
  Screen,
} from "./ui";

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
  const [activities, setActivities] = useState<string[]>([]);
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
          activities,
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
        <PageHeader
          eyebrow="Welcome"
          title="Tell us about you"
          subtitle="A few basics so we can tailor your health tracking."
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
            <ul className="mt-1 flex flex-col gap-1 text-xs font-normal text-muted">
              {ACTIVITY_LEVEL.map((v) => (
                <li key={v}>
                  <span className="font-medium text-foreground/70">
                    {ACTIVITY_LEVEL_LABELS[v]}:
                  </span>{" "}
                  {ACTIVITY_LEVEL_DESCRIPTIONS[v]}
                </li>
              ))}
            </ul>
          </label>

          <div className={labelClass}>
            <span>Which activities do you do?</span>
            <span className="text-xs font-normal text-muted">
              Pick the ones you do regularly — they become your quick options at
              check-in. You can change these anytime.
            </span>
            <div className="mt-1">
              <ActivityChips value={activities} onChange={setActivities} />
            </div>
          </div>

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
