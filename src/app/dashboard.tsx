"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PRIMARY_GOAL_LABELS, type ProfileRow } from "@/lib/profile";
import {
  Card,
  Eyebrow,
  PageHeader,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

interface Summary {
  streak: number;
  pointsBalance: number;
  checkedInToday: boolean;
}

/**
 * Home tab. Rendered inside the AppShell, so it returns content only. Pulls the
 * check-in summary (streak, points, today's status) from GET /api/checkin and
 * routes the user into the Check-in tab.
 */
export function Dashboard({
  profile,
  getToken,
  onEdit,
  onCheckIn,
  refreshKey,
}: {
  profile: ProfileRow;
  getToken: () => Promise<string | null>;
  onEdit: () => void;
  onCheckIn: () => void;
  refreshKey: number;
}) {
  const firstName = profile.full_name.split(" ")[0] || profile.full_name;
  const [summary, setSummary] = useState<Summary | null>(null);
  const loadedKey = useRef(-1);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/checkin", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as Summary;
      setSummary(data);
    } catch (err) {
      console.error("Failed to load dashboard summary:", err);
    }
  }, [getToken]);

  useEffect(() => {
    // Fetch once per distinct refreshKey (mount + after each new check-in).
    if (loadedKey.current === refreshKey) return;
    loadedKey.current = refreshKey;
    void load();
  }, [load, refreshKey]);

  const checkedInToday = summary?.checkedInToday ?? false;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Home"
        title={`Welcome, ${firstName}`}
        subtitle="Your baseline is set up. Check in daily to build your streak."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="flex flex-col gap-2 p-6">
          <Eyebrow>Primary goal</Eyebrow>
          <p className="font-display text-2xl font-medium text-foreground">
            {PRIMARY_GOAL_LABELS[profile.primary_goal]}
          </p>
        </Card>

        <Card className="flex flex-col gap-2 p-6">
          <Eyebrow>Streak</Eyebrow>
          <p className="font-display text-2xl font-medium text-foreground">
            {summary?.streak ?? 0}
            <span className="ml-1 font-body text-sm text-muted">
              {summary?.streak === 1 ? "day" : "days"}
            </span>
          </p>
        </Card>

        <Card className="flex flex-col gap-2 p-6">
          <Eyebrow>iki points</Eyebrow>
          <p className="font-display text-2xl font-medium text-foreground">
            {summary?.pointsBalance ?? 0}
          </p>
        </Card>
      </div>

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <p className="font-body text-sm font-medium text-foreground">
            {checkedInToday
              ? "You've checked in today. Nice work."
              : "Ready for today's check-in?"}
          </p>
          <p className="font-body text-sm text-muted">
            {checkedInToday
              ? "Come back tomorrow to keep your streak alive."
              : "A 30-second check-in earns iki points and grows your streak."}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button onClick={onCheckIn} className={primaryButtonClass}>
            {checkedInToday ? "View check-in" : "Check in"}
          </button>
          <button onClick={onEdit} className={secondaryButtonClass}>
            Edit profile
          </button>
        </div>
      </Card>
    </div>
  );
}
