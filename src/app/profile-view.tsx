"use client";

import {
  ACTIVITY_LEVEL_LABELS,
  BIOLOGICAL_SEX_LABELS,
  PRIMARY_GOAL_LABELS,
  type ProfileRow,
} from "@/lib/profile";
import { EXERCISE_TYPE_LABELS, isExerciseType } from "@/lib/exercises";
import { Card, Eyebrow, secondaryButtonClass } from "./ui";

/**
 * Read-only view of the user's profile. Editing is deliberately gated behind
 * the "Edit profile" action (top-right) so the default state is view, not edit.
 */
export function ProfileView({
  profile,
  onEdit,
}: {
  profile: ProfileRow;
  onEdit: () => void;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Full name", value: profile.full_name },
    { label: "Date of birth", value: profile.date_of_birth },
    { label: "Gender", value: BIOLOGICAL_SEX_LABELS[profile.biological_sex] },
    { label: "Primary goal", value: PRIMARY_GOAL_LABELS[profile.primary_goal] },
    { label: "Activity level", value: ACTIVITY_LEVEL_LABELS[profile.activity_level] },
    { label: "Known conditions", value: profile.known_conditions || "—" },
    { label: "Country", value: profile.country || "—" },
    { label: "City", value: profile.city || "—" },
    {
      label: "Activities",
      value:
        profile.activities && profile.activities.length > 0
          ? profile.activities
              .filter(isExerciseType)
              .map((t) => EXERCISE_TYPE_LABELS[t])
              .join(", ")
          : "—",
    },
    { label: "Product emails", value: profile.marketing_consent ? "On" : "Off" },
  ];

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Eyebrow>Profile</Eyebrow>
          <h1 className="font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            {profile.full_name}
          </h1>
        </div>
        <button onClick={onEdit} className={`${secondaryButtonClass} shrink-0`}>
          Edit profile
        </button>
      </div>

      <Card className="divide-y divide-border">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-baseline justify-between gap-4 px-5 py-3.5"
          >
            <span className="font-body text-sm text-muted">{r.label}</span>
            <span className="text-right font-body text-sm font-medium text-foreground">
              {r.value}
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}
