"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { rankFor } from "@/lib/iki-rank";
import { PRIMARY_GOAL_LABELS, type ProfileRow } from "@/lib/profile";
import type { RankCardInput } from "@/lib/rank-share-card";
import { RankBadge } from "./rank-badge";
import { RankShareModal } from "./rank-share-modal";
import { WearableHomeCard } from "./wearable-home-card";

interface Summary {
  streak: number;
  pointsBalance: number;
  checkedInToday: boolean;
  ikiScore: number;
}

/** Shimmer stand-in for a stat value while the summary loads, never a fake 0. */
function StatPlaceholder() {
  return <div className="h-8 w-16 animate-pulse rounded-ctl bg-surface-2" />;
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
  onOpenSettings,
  refreshKey,
}: {
  profile: ProfileRow;
  getToken: () => Promise<string | null>;
  onCheckIn: () => void;
  /** Devices are managed in Settings; Home only points at them. */
  onOpenSettings: () => void;
  refreshKey: number;
}) {
  const firstName = profile.full_name.split(" ")[0] || profile.full_name;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
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

  /**
   * The invite code is fetched only when the share sheet opens. Most visits to
   * Home never open it, and the card renders fine without one.
   */
  const openShare = useCallback(async () => {
    setShareOpen(true);
    if (inviteCode) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/referral", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { code?: string };
      if (data.code) setInviteCode(data.code);
    } catch {
      /* the card is still shareable without it */
    }
  }, [getToken, inviteCode]);

  const checkedInToday = summary?.checkedInToday ?? false;

  return (
    <div className="flex flex-col gap-stack">
      <header className="flex flex-col gap-1.5">
        <p className="iki-eyebrow">Home</p>
        <h1 className="iki-title">Welcome, {firstName}</h1>
        <p className="iki-lede">
          Your baseline is set up. Check in daily to build your streak.
        </p>
      </header>

      {/*
        The rank card leads Home. It used to sit on the Check-in tab, which
        meant the one thing that shows a user how far they have come was behind
        a tab they only opened to file today's entry, and invisible on the
        days they did not check in at all.
      */}
      {summary && (
        <RankBadge score={summary.ikiScore} onShare={() => void openShare()} />
      )}

      {/* THE STAT DUO, then the goal. The three used to share one row, which
          put a number you watch daily beside a preference you set once and
          gave all three the same weight. */}
      <div className="grid grid-cols-2 gap-2.5">
        <section className="iki-card iki-card-tight flex flex-col gap-1">
          <p className="iki-eyebrow">Streak</p>
          {summary ? (
            <p className="font-display text-display-md font-medium leading-none text-ink">
              {summary.streak}
              <span className="ml-1 font-sans text-unit text-muted">
                {summary.streak === 1 ? "day" : "days"}
              </span>
            </p>
          ) : (
            <StatPlaceholder />
          )}
        </section>

        <section className="iki-card iki-card-tight flex flex-col gap-1">
          {/* "To spend", against the rank card's "earned" directly above it.
              Two different quantities, and until they were named they looked
              like one quantity reported twice with different answers. */}
          <p className="iki-eyebrow">iki to spend</p>
          {summary ? (
            <p className="font-display text-display-md font-medium leading-none text-ink">
              {summary.pointsBalance}
            </p>
          ) : (
            <StatPlaceholder />
          )}
        </section>
      </div>

      <section className="iki-card iki-card-tight flex flex-col gap-1">
        <p className="iki-eyebrow">Primary goal</p>
        <p className="font-display text-display-sm font-medium text-ink">
          {PRIMARY_GOAL_LABELS[profile.primary_goal]}
        </p>
      </section>

      {summary ? (
        <section className="iki-card flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2.5 text-body font-semibold text-ink">
              {/* The one decorative loop in the app, spent on the single action
                  this screen exists to prompt, and only while it is still
                  outstanding. Once today is logged there is nothing to nudge. */}
              {!checkedInToday && <span className="iki-ping" aria-hidden />}
              {checkedInToday
                ? "You've checked in today. Nice work."
                : "Ready for today's check-in?"}
            </p>
            <p className="text-caption leading-relaxed text-muted">
              {checkedInToday
                ? "Come back tomorrow to keep your streak alive."
                : "A 30-second check-in earns iki points and grows your streak."}
            </p>
          </div>
          <button
            type="button"
            onClick={onCheckIn}
            className="iki-btn iki-btn-primary w-full"
          >
            {checkedInToday ? "View check-in" : "Check in"}
          </button>
        </section>
      ) : (
        <section className="iki-card flex flex-col gap-3">
          <div className="flex animate-pulse flex-col gap-2">
            <div className="h-4 w-48 rounded-ctl bg-surface-2" />
            <div className="h-4 w-64 max-w-full rounded-ctl bg-surface-2" />
          </div>
          <div className="h-ctl-lg w-full animate-pulse rounded-ctl bg-surface-2" />
        </section>
      )}

      {/* NOT IN THE MOCKUP, KEPT. Either the pitch to connect a device or, once
          one is connected, the sync control and the schedule behind it. It
          renders itself away when neither applies. */}
      <WearableHomeCard getToken={getToken} onOpenSettings={onOpenSettings} />

      {shareOpen && summary && (
        <RankShareModal
          input={
            {
              ...rankCardFields(rankFor(summary.ikiScore)),
              ikiScore: summary.ikiScore,
              streak: summary.streak,
              date: new Date(),
              referralCode: inviteCode,
            } satisfies RankCardInput
          }
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

/** The rank half of the card input, so the shape stays in one place. */
function rankCardFields(rank: ReturnType<typeof rankFor>) {
  return {
    rankId: rank.id,
    rankName: rank.name,
    kanji: rank.kanji,
    scene: rank.scene,
  };
}
