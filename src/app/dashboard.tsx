"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PRIMARY_GOAL_LABELS, type ProfileRow } from "@/lib/profile";
import { Card, Eyebrow, PageHeader, primaryButtonClass } from "./ui";

interface Summary {
  streak: number;
  pointsBalance: number;
  checkedInToday: boolean;
}

/** Shimmer stand-in for a stat value while the summary loads — never a fake 0. */
function StatPlaceholder() {
  return <div className="h-8 w-16 animate-pulse rounded bg-surface-2" />;
}

/**
 * Home tab. Rendered inside the AppShell, so it returns content only. Pulls the
 * check-in summary (streak, points, today's status) from GET /api/checkin and
 * routes the user into the Check-in tab.
 */
export function Dashboard({
  profile,
  getToken,
  onCheckIn,
  refreshKey,
}: {
  profile: ProfileRow;
  getToken: () => Promise<string | null>;
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
          {summary ? (
            <p className="font-display text-2xl font-medium text-foreground">
              {summary.streak}
              <span className="ml-1 font-body text-sm text-muted">
                {summary.streak === 1 ? "day" : "days"}
              </span>
            </p>
          ) : (
            <StatPlaceholder />
          )}
        </Card>

        <Card className="flex flex-col gap-2 p-6">
          <Eyebrow>iki points</Eyebrow>
          {summary ? (
            <p className="font-display text-2xl font-medium text-foreground">
              {summary.pointsBalance}
            </p>
          ) : (
            <StatPlaceholder />
          )}
        </Card>
      </div>

      {summary ? (
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
          <div>
            <button onClick={onCheckIn} className={primaryButtonClass}>
              {checkedInToday ? "View check-in" : "Check in"}
            </button>
          </div>
        </Card>
      ) : (
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex animate-pulse flex-col gap-2">
            <div className="h-4 w-48 rounded bg-surface-2" />
            <div className="h-4 w-64 max-w-full rounded bg-surface-2" />
          </div>
          <div className="h-11 w-32 animate-pulse rounded-control bg-surface-2" />
        </Card>
      )}
    </div>
  );
}
