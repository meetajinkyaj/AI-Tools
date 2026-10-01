"use client";

import {
  ACTIVITY_LEVEL_LABELS,
  BIOLOGICAL_SEX_LABELS,
  PRIMARY_GOAL_LABELS,
  type ProfileRow,
} from "@/lib/profile";
import { EXERCISE_TYPE_LABELS, isExerciseType } from "@/lib/exercises";
import type { PrimaryGoal } from "@/lib/profile";
import { initialsOf } from "./app-shell";
import { NotificationSettings } from "./notification-settings";
import { ThemeControl } from "./theme-control";
import { WearableSettings } from "./wearable-settings";

/** Which pillar a primary goal belongs to, for the hue of its chip's dot. */
export const GOAL_PILLAR: Record<PrimaryGoal, "performance" | "recovery" | "longevity"> = {
  fat_loss: "performance",
  muscle_gain: "performance",
  hrv: "recovery",
  longevity: "longevity",
  metabolic_health: "longevity",
};

/** "Nov 2025", from the profile's creation date. */
export function memberSince(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Read-only view of the user's profile (UI v2, section 4.8). Editing is
 * deliberately gated behind "Edit profile", which v2 moves into the header
 * (authed-app passes it to the shell), so the default state is view, not edit.
 */
export function ProfileView({
  profile,
  onLogout,
  getToken,
}: {
  profile: ProfileRow;
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

  const since = memberSince(profile.created_at);

  return (
    <div className="flex w-full max-w-md flex-col gap-stack">
      <header className="flex items-center gap-4">
        <span className="iki-identity-avatar" aria-hidden>
          {initialsOf(profile.full_name)}
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="sr-only">Profile</p>
          <h1 className="font-display text-display-name text-ink">{profile.full_name}</h1>
          <div className="flex flex-wrap gap-2">
            <span className="iki-chip">
              <span
                className="iki-pillar-dot"
                style={{ background: `var(--pillar-${GOAL_PILLAR[profile.primary_goal]})` }}
                aria-hidden
              />
              {PRIMARY_GOAL_LABELS[profile.primary_goal]}
            </span>
            {since && <span className="iki-chip">Member since {since}</span>}
          </div>
        </div>
      </header>

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

      <ThemeControl />

      <WearableSettings getToken={getToken} />

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
        <a href="/support" className="iki-tap underline underline-offset-2">
          Support
        </a>
      </p>

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

    </div>
  );
}
