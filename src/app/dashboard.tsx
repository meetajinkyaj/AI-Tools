"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CatalogEntry } from "@/lib/biomarkers";
import {
  type DayStatus,
  filledDots,
  ikiScore100,
  type NextUnlock,
  nextUnlock,
  type PanelCounts,
  pillarFractions,
  type RewardItem,
  type WeekInputs,
} from "@/lib/home-summary";
import { rankFor, rankProgress } from "@/lib/iki-rank";
import { summarizePanel, type JudgedReading } from "@/lib/panel-summary";
import { POINTS } from "@/lib/points";
import type { ProfileRow } from "@/lib/profile";
import type { RankCardInput } from "@/lib/rank-share-card";
import { Heatmap, RankKanji, Rings } from "./data-marks";
import { Icon } from "./icons";
import { RankShareModal } from "./rank-share-modal";
import { RankSheet } from "./rank-sheet";
import { WearableHomeCard } from "./wearable-home-card";

interface Summary {
  streak: number;
  pointsBalance: number;
  checkedInToday: boolean;
  /** Lifetime iki earned. Drives rank. Not the 0-100 score on the card. */
  ikiScore: number;
  last30?: DayStatus[];
  pointsToday?: number;
  week?: WeekInputs;
  weekBefore?: WeekInputs;
}

/** A time-of-day greeting, from the viewer's local clock. */
function greetingFor(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

/** "Tuesday · 29 Sep", the Home eyebrow. */
function dateEyebrow(date = new Date()): string {
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  const dayMonth = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${weekday} · ${dayMonth}`;
}

/** Shimmer stand-in for a value while it loads, never a fake 0. */
function Placeholder({ className = "h-8 w-16" }: { className?: string }) {
  return <div className={`${className} animate-pulse rounded-ctl bg-surface-2`} />;
}

async function getJson<T>(url: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Home (UI v2, section 4.1). Rendered inside the AppShell, so it returns
 * content only.
 *
 * Four sources, each optional: the check-in summary (rank, streak, score
 * inputs), the latest panel (Report tile, Longevity pillar), the rewards
 * catalogue (Rewards tile) and wearables (the device row). Any of them failing
 * leaves its own card in a quiet state rather than taking Home down.
 */
export function Dashboard({
  profile,
  getToken,
  onCheckIn,
  onOpenSettings,
  onOpenReport,
  onOpenRewards,
  refreshKey,
}: {
  profile: ProfileRow;
  getToken: () => Promise<string | null>;
  onCheckIn: () => void;
  /** Devices are managed on Profile; Home only points at them. */
  onOpenSettings: () => void;
  onOpenReport: () => void;
  onOpenRewards: () => void;
  refreshKey: number;
}) {
  const firstName = profile.full_name.split(" ")[0] || profile.full_name;
  const [summary, setSummary] = useState<Summary | null>(null);
  /** undefined while loading, null when there is no panel yet. */
  const [panel, setPanel] = useState<PanelCounts | null | undefined>(undefined);
  const [rewards, setRewards] = useState<{ balance: number; unlock: NextUnlock } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [rankOpen, setRankOpen] = useState(false);
  const rankRowRef = useRef<HTMLButtonElement>(null);
  const closeRank = useCallback(() => {
    setRankOpen(false);
    // Back to the row that opened it, not the top of the document.
    rankRowRef.current?.focus();
  }, []);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const loadedKey = useRef(-1);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const [s, report, red] = await Promise.all([
      getJson<Summary>("/api/checkin", token),
      getJson<{
        catalog: CatalogEntry[];
        latestPanel: { readings: JudgedReading[] } | null;
      }>("/api/biomarkers", token),
      getJson<{ balance: number; items: RewardItem[] }>("/api/redemptions", token),
    ]);
    if (s) setSummary(s);
    if (report) {
      const readings = report.latestPanel?.readings ?? [];
      if (readings.length === 0) setPanel(null);
      else {
        const counted = summarizePanel(readings, report.catalog);
        setPanel({ inRange: counted.inRange, total: counted.total, worthALook: counted.worthALook.length });
      }
    } else {
      setPanel(null);
    }
    if (red) setRewards({ balance: red.balance, unlock: nextUnlock(red.items, red.balance) });
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
    const token = await getToken();
    if (!token) return;
    const data = await getJson<{ code?: string }>("/api/referral", token);
    if (data?.code) setInviteCode(data.code);
  }, [getToken, inviteCode]);

  const checkedInToday = summary?.checkedInToday ?? false;

  return (
    <div className="flex flex-col gap-stack">
      <header className="flex flex-col gap-1.5">
        <p className="iki-eyebrow">{dateEyebrow()}</p>
        <h1 className="iki-title">
          {greetingFor()}, {firstName}
        </h1>
      </header>

      {summary ? (
        <ScoreCard
          summary={summary}
          panel={panel ?? null}
          rankRowRef={rankRowRef}
          onOpenRank={() => setRankOpen(true)}
          onShare={() => void openShare()}
        />
      ) : (
        <section className="iki-card flex flex-col gap-4">
          <Placeholder className="h-12 w-48" />
          <Placeholder className="h-20 w-full" />
        </section>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2.5">
        <ReportTile panel={panel} onOpen={onOpenReport} />
        <RewardsTile rewards={rewards} onOpen={onOpenRewards} />
      </div>

      {summary && <StreakCard streak={summary.streak} last30={summary.last30} />}

      {summary ? (
        <section className="iki-card flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2.5 text-body-lg font-semibold text-ink">
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
                : `Thirty seconds. +${POINTS.checkin} iki, and the streak holds.`}
            </p>
          </div>
          <button type="button" onClick={onCheckIn} className="iki-btn iki-btn-primary w-full">
            {checkedInToday ? "View check-in" : "Check in"}
          </button>
        </section>
      ) : (
        <section className="iki-card flex flex-col gap-3">
          <Placeholder className="h-4 w-48" />
          <Placeholder className="h-ctl-lg w-full" />
        </section>
      )}

      {/* The device row: the pitch to connect, or the sync control once a
          device is connected. It renders itself away when neither applies. */}
      <WearableHomeCard getToken={getToken} onOpenSettings={onOpenSettings} />

      {rankOpen && summary && (
        <RankSheet
          score={summary.ikiScore}
          onShare={() => {
            setRankOpen(false);
            void openShare();
          }}
          onClose={closeRank}
        />
      )}

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

/* ------------------------------- score card ------------------------------- */

const PILLARS = [
  { key: "performance", label: "Performance", color: "var(--pillar-performance)" },
  { key: "recovery", label: "Recovery", color: "var(--pillar-recovery)" },
  { key: "longevity", label: "Longevity", color: "var(--pillar-longevity)" },
] as const;

export function ScoreCard({
  summary,
  panel,
  rankRowRef,
  onOpenRank,
  onShare,
}: {
  summary: Summary;
  panel: PanelCounts | null;
  rankRowRef?: React.Ref<HTMLButtonElement>;
  onOpenRank: () => void;
  onShare: () => void;
}) {
  const progress = rankProgress(summary.ikiScore);
  const week = summary.week ?? { trainingDays: 0, avgSleep: null };
  const fractions = pillarFractions(week, panel);
  const score = ikiScore100(fractions);
  const yesterday = summary.weekBefore ? ikiScore100(pillarFractions(summary.weekBefore, panel)) : null;
  const delta = score != null && yesterday != null ? score - yesterday : null;
  const pointsToday = summary.pointsToday ?? 0;

  const values: Record<(typeof PILLARS)[number]["key"], { value: string; unit: string }> = {
    performance: { value: `${week.trainingDays}×`, unit: "this week" },
    recovery:
      week.avgSleep == null
        ? { value: "-", unit: "no sleep logged" }
        : { value: `${week.avgSleep}`, unit: "h sleep" },
    longevity: panel
      ? { value: `${panel.inRange}`, unit: `of ${panel.total} in range` }
      : { value: "-", unit: "no panel yet" },
  };

  return (
    <section className="iki-card flex flex-col px-card pt-5 pb-card">
      {/* Rank row. The whole row opens the rank ladder; Share goes straight
          to the share card, which is why it is a separate button. */}
      <div className="flex items-center gap-3">
        <button
          ref={rankRowRef}
          type="button"
          onClick={onOpenRank}
          aria-haspopup="dialog"
          className="iki-press flex min-h-tap min-w-0 flex-1 items-center gap-3 text-left"
          aria-label={`Rank: ${progress.rank.name}, ${summary.ikiScore.toLocaleString("en-US")} iki. Open the rank ladder`}
        >
          <span className="iki-seal">
            <RankKanji id={progress.rank.id} size={22} />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="iki-eyebrow">Rank</span>
            <span className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-display text-display-md text-ink">{progress.rank.name}</span>
              <span className="text-small text-muted">
                · {summary.ikiScore.toLocaleString("en-US")} iki
              </span>
            </span>
          </span>
        </button>
        <button type="button" onClick={onShare} className="iki-tap iki-press iki-pill-sm shrink-0">
          <Icon name="share" size={12} strokeWidth={2} />
          Share
        </button>
      </div>

      <div
        className="iki-track mt-4"
        role="progressbar"
        aria-label="Progress to the next rank"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress.fraction * 100)}
      >
        <div className="iki-track-fill" style={{ width: `${progress.fraction * 100}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-micro uppercase tracking-[0.1em] text-muted">
        <span className="flex min-w-0 items-center gap-1">
          {progress.next ? (
            <>
              {progress.remaining.toLocaleString("en-US")} iki to
              <RankKanji id={progress.next.id} size={12} />
              <span className="truncate">{progress.next.name}</span>
            </>
          ) : (
            "Top of the ladder"
          )}
        </span>
        {pointsToday > 0 && (
          <span className="shrink-0 font-semibold text-primary">+{pointsToday} today</span>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="iki-eyebrow">Iki score</p>
            <div className="flex items-end gap-3">
              <p className="font-display text-display-2xl text-ink">{score ?? "-"}</p>
              {delta != null && (
                <span className="iki-delta mb-1">
                  <Icon
                    name="arrow-up-right"
                    size={12}
                    strokeWidth={2}
                    className={delta < 0 ? "rotate-90 text-muted" : "text-primary"}
                  />
                  <span className={delta < 0 ? "text-muted" : "text-primary"}>
                    {delta > 0 ? `+${delta}` : delta}
                  </span>
                  <span className="uppercase tracking-[0.1em] text-muted">yesterday</span>
                </span>
              )}
            </div>
          </div>
          <Rings
            size={64}
            stroke={4}
            radii={[28, 20, 12]}
            rings={[
              { value: fractions.performance, color: PILLARS[0].color },
              { value: fractions.recovery ?? 0, color: PILLARS[1].color },
              { value: fractions.longevity ?? 0, color: PILLARS[2].color },
            ]}
            centreDot={3.5}
          />
        </div>

        <ul className="mt-3 flex flex-col">
          {PILLARS.map((p) => (
            <li key={p.key} className="flex items-center gap-3 border-t border-line py-2.75">
              <span className="iki-pillar-dot" style={{ background: p.color }} aria-hidden />
              <span className="iki-pillar-label flex-1">{p.label}</span>
              <span className="text-body-lg font-semibold text-ink">
                {values[p.key].value}{" "}
                <span className="text-small font-normal text-muted">{values[p.key].unit}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------- tiles --------------------------------- */

export function ReportTile({ panel, onOpen }: { panel: PanelCounts | null | undefined; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="iki-press iki-bento">
      <span className="flex items-center justify-between">
        <span className="iki-eyebrow">Report</span>
        <Icon name="arrow-up-right" size={14} className="text-muted" />
      </span>
      {panel === undefined ? (
        <Placeholder className="h-14 w-14 rounded-pill" />
      ) : (
        <Rings
          size={56}
          stroke={5}
          radii={[25.5]}
          rings={[{ value: panel ? panel.inRange / panel.total : 0, color: "var(--pillar-longevity)" }]}
        />
      )}
      <span className="mt-auto flex flex-col gap-1">
        {panel ? (
          <>
            <span className="font-display text-display-tile text-ink">
              {panel.inRange}
              <span className="text-muted"> / {panel.total}</span>
            </span>
            <span className="text-micro text-muted">
              in range
              {panel.worthALook > 0 && ` · ${panel.worthALook} worth a look`}
            </span>
          </>
        ) : panel === null ? (
          <span className="text-micro text-muted">Upload your first panel</span>
        ) : null}
      </span>
    </button>
  );
}

export function RewardsTile({
  rewards,
  onOpen,
}: {
  rewards: { balance: number; unlock: NextUnlock } | null;
  onOpen: () => void;
}) {
  const filled = !rewards
    ? 0
    : rewards.unlock.state === "locked"
      ? filledDots(rewards.balance, rewards.unlock.cost)
      : rewards.unlock.state === "all-affordable"
        ? 16
        : 0;

  return (
    <button type="button" onClick={onOpen} className="iki-press iki-bento">
      <span className="iki-eyebrow">Rewards</span>
      <span className="iki-dots" aria-hidden>
        {Array.from({ length: 16 }, (_, i) => (
          <span key={i} className="iki-dot" data-on={i < filled} />
        ))}
      </span>
      <span className="mt-auto flex flex-col gap-1">
        {rewards ? (
          <>
            <span className="font-display text-display-tile text-primary">
              {rewards.balance.toLocaleString("en-US")}
              <span className="font-sans text-unit"> iki</span>
            </span>
            <span className="text-micro text-muted">
              {rewards.unlock.state === "locked"
                ? `${rewards.unlock.remaining.toLocaleString("en-US")} to ${[rewards.unlock.partner, rewards.unlock.name]
                    .filter(Boolean)
                    .join(" · ")}`
                : rewards.unlock.state === "all-affordable"
                  ? "Enough for any voucher"
                  : "Vouchers arriving soon"}
            </span>
          </>
        ) : (
          <Placeholder className="h-7 w-20" />
        )}
      </span>
    </button>
  );
}

/* --------------------------------- streak --------------------------------- */

export function StreakCard({ streak, last30 }: { streak: number; last30?: DayStatus[] }) {
  const days = last30 ?? Array<DayStatus>(30).fill("n");
  return (
    <section className="iki-card flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <p className="iki-eyebrow">Streak</p>
        <p className="font-display text-display-md text-ink">
          {streak}
          <span className="ml-1 font-sans text-unit text-muted">{streak === 1 ? "day" : "days"}</span>
        </p>
      </div>
      <Heatmap days={days} />
    </section>
  );
}

/** The rank half of the share-card input, so the shape stays in one place. */
function rankCardFields(rank: ReturnType<typeof rankFor>) {
  return {
    rankId: rank.id,
    rankName: rank.name,
    kanji: rank.kanji,
    scene: rank.scene,
  };
}
