"use client";

import { PRIMARY_GOAL_LABELS, type ProfileRow } from "@/lib/profile";
import { Card, Eyebrow, PageHeader, secondaryButtonClass } from "./ui";

/**
 * Home tab content. Rendered inside the AppShell, so it returns content only
 * (no full-screen wrapper, no log-out — those live in the shell).
 */
export function Dashboard({
  profile,
  onEdit,
}: {
  profile: ProfileRow;
  onEdit: () => void;
}) {
  const firstName = profile.full_name.split(" ")[0] || profile.full_name;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Home"
        title={`Welcome, ${firstName}`}
        subtitle="Your baseline is set up. Health tracking is coming online soon."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col gap-2 p-6">
          <Eyebrow>Primary goal</Eyebrow>
          <p className="font-display text-2xl font-medium text-foreground">
            {PRIMARY_GOAL_LABELS[profile.primary_goal]}
          </p>
        </Card>

        <Card className="flex flex-col gap-2 p-6">
          <Eyebrow>iki points</Eyebrow>
          <p className="font-display text-2xl font-medium text-foreground">0</p>
          <p className="font-body text-xs text-muted">
            Earn points from daily check-ins and your first blood panel.
          </p>
        </Card>
      </div>

      <Card className="flex flex-col gap-4 p-6">
        <p className="font-body text-sm text-muted">
          Daily check-ins, your biomarker report, and rewards will appear here
          as each section comes online.
        </p>
        <button onClick={onEdit} className={secondaryButtonClass}>
          Edit profile
        </button>
      </Card>
    </div>
  );
}
