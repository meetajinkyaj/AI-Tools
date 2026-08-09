"use client";

import {
  ACTIVITY_LEVEL_LABELS,
  BIOLOGICAL_SEX_LABELS,
  PRIMARY_GOAL_LABELS,
  type ProfileRow,
} from "@/lib/profile";
import { EXERCISE_TYPE_LABELS, isExerciseType } from "@/lib/exercises";
import { NotificationSettings } from "./notification-settings";
import { WearableSettings } from "./wearable-settings";

/**
 * Read-only view of the user's profile. Editing is deliberately gated behind
 * the "Edit profile" action (top-right) so the default state is view, not edit.
 */
export function ProfileView({
  profile,
  onEdit,
  onLogout,
  getToken,
}: {
  profile: ProfileRow;
  onEdit: () => void;
  /** Moved here from the shell header when the bottom nav replaced it. */
  onLogout?: () => void;
  getToken: () => Promise<string | null>;
}) {
  /*
   * NO "FULL NAME" ROW. It is the heading immediately above this card, and a
   * value printed twice within one screenful reads as a rendering fault rather
   * than as emphasis. The mockup drops it for the same reason; it is the only
   * row this restyle removes, and nothing else about the profile changed.
   */
  const rows: { label: string; value: string }[] = [
    { label: "Date of birth", value: profile.date_of_birth },
    { label: "Gender", value: BIOLOGICAL_SEX_LABELS[profile.biological_sex] },
    { label: "Primary goal", value: PRIMARY_GOAL_LABELS[profile.primary_goal] },
    { label: "Activity level", value: ACTIVITY_LEVEL_LABELS[profile.activity_level] },
    { label: "Known conditions", value: profile.known_conditions || "-" },
    { label: "Country", value: profile.country || "-" },
    { label: "City", value: profile.city || "-" },
    {
      label: "Activities",
      value:
        profile.activities && profile.activities.length > 0
          ? profile.activities
              .filter(isExerciseType)
              .map((t) => EXERCISE_TYPE_LABELS[t])
              .join(", ")
          : "-",
    },
    { label: "Product emails", value: profile.marketing_consent ? "On" : "Off" },
  ];

  return (
    <div className="flex w-full max-w-md flex-col gap-stack">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="iki-eyebrow">Profile</p>
          <h1 className="iki-title">{profile.full_name}</h1>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="iki-btn iki-btn-secondary shrink-0"
        >
          Edit profile
        </button>
      </div>

      <section className="iki-card iki-card-tight flex flex-col">
        {rows.map((r) => (
          <div key={r.label} className="iki-row">
            {/* The label never wraps and the value takes what is left, so a
                long list of activities flows onto a second line under itself
                rather than squeezing "Activities" into two words. */}
            <span className="iki-row-label shrink-0">{r.label}</span>
            <span className="iki-row-value">{r.value}</span>
          </div>
        ))}
      </section>

      <NotificationSettings getToken={getToken} />

      <WearableSettings getToken={getToken} />

      {/*
        LOG OUT LIVES HERE NOW. It used to sit in the shell's header, which the
        bottom nav replaced; the design puts it at the foot of Profile, which is
        also where somebody looks for it. Bare and quiet on purpose: it is not
        an action the screen is encouraging.
      */}
      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className="iki-btn iki-btn-ceremonial w-full border-0"
        >
          Log out
        </button>
      )}

      {/* The old shell footer carried these. Losing the only route to the
          privacy policy and the terms from inside the app would be a
          regression a redesign has no business causing. */}
      <p className="flex justify-center gap-4 text-micro text-muted">
        <a href="/privacy" className="iki-tap underline underline-offset-2">
          Privacy
        </a>
        <a href="/terms" className="iki-tap underline underline-offset-2">
          Terms
        </a>
      </p>
    </div>
  );
}
