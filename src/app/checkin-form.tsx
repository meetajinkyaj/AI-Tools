"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { rankProgress, type Rank } from "@/lib/iki-rank";
import { RankUpToast } from "./rank-badge";
import { ShareCheckinCard } from "./share-card";
import { ShareModal } from "./share-modal";

import { ENERGY_LABELS, type CheckinRow } from "@/lib/checkin";
import type { DayStatus } from "@/lib/home-summary";
import { POINTS } from "@/lib/points";
import {
  DURATION_LABELS,
  type DurationBucket,
  EXERCISE_TYPE_LABELS,
  EXERCISE_TYPES,
  type ExerciseEntry,
  type ExerciseType,
  isExerciseType,
  OTHER_TYPE,
} from "@/lib/exercises";
import {
  ActivityTile,
  DurationSegmented,
  EnergyScale,
  HoldToSubmit,
  pillarForActivity,
  SleepStepper,
} from "./checkin-controls";
import { Heatmap } from "./data-marks";
import { Icon } from "./icons";
import { Switch } from "./switch";
import { fieldClass } from "./ui";

interface CheckinState {
  checkin: CheckinRow | null;
  checkedInToday: boolean;
  streak: number;
  pointsBalance: number;
  /** Lifetime, unboosted, drives the rank badge. */
  ikiScore?: number;
  /** v2: the 30-day heatmap and what today earned, from GET /api/checkin. */
  last30?: DayStatus[];
  pointsToday?: number;
}

/** Which of the two check-in views is showing, for the shell's header link. */
export type CheckinMode = "form" | "saved";

/**
 * The Daily Check-in tab: a 30-second flow (energy, sleep, training, a note)
 * that earns iki points on the day's first submission. Loads today's status
 * from GET /api/checkin and writes via POST.
 */
export function CheckinForm({
  getToken,
  activities,
  onChange,
  onModeChange,
}: {
  getToken: () => Promise<string | null>;
  activities: string[];
  onChange?: () => void;
  /** Lets the shell label its header link "Cancel" (form) or "Done" (saved). */
  onModeChange?: (mode: CheckinMode) => void;
}) {
  const [state, setState] = useState<CheckinState | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [energy, setEnergy] = useState<number | null>(null);
  const [sleepHours, setSleepHours] = useState<number | null>(null);
  const [trainingLogged, setTrainingLogged] = useState(false);
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earned, setEarned] = useState<number | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [showShare, setShowShare] = useState(false);
  // The modal is the post-save interruption; `showShare` is the inline
  // "come back later" path. Kept apart so dismissing one never hides the other.
  const [shareModal, setShareModal] = useState(false);
  const [rankUp, setRankUp] = useState<Rank | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  /** Editing today's check-in after it was saved (v2: "Update check-in"). */
  const [editing, setEditing] = useState(false);
  const [showAllActivities, setShowAllActivities] = useState(false);
  const startedRef = useRef(false);

  // Any edit after a save clears the "Done" confirmation so the button invites
  // another save.
  function markEdited() {
    if (justSaved) setJustSaved(false);
  }

  function toggleExercise(type: string) {
    markEdited();
    setExercises((prev) =>
      prev.some((e) => e.type === type)
        ? prev.filter((e) => e.type !== type)
        : [...prev, { type, label: null, duration: null }],
    );
  }

  function setDuration(type: string, duration: DurationBucket) {
    markEdited();
    setExercises((prev) =>
      prev.map((e) =>
        e.type === type
          ? { ...e, duration: e.duration === duration ? null : duration }
          : e,
      ),
    );
  }

  function setOtherLabel(label: string) {
    markEdited();
    setExercises((prev) =>
      prev.map((e) =>
        e.type === OTHER_TYPE ? { ...e, label: label || null } : e,
      ),
    );
  }

  const applyCheckin = useCallback((c: CheckinRow | null) => {
    setEnergy(c?.energy_score ?? null);
    setSleepHours(c?.sleep_hours ?? null);
    setTrainingLogged(c?.training_logged ?? false);
    setExercises(c?.exercises ?? []);
    setNote(c?.nutrition_note ?? "");
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      if (!token) return setStatus("error");
      const res = await fetch("/api/checkin", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return setStatus("error");
      const data = (await res.json()) as CheckinState;
      setState(data);
      applyCheckin(data.checkin);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load check-in:", err);
      setStatus("error");
    }
  }, [getToken, applyCheckin]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  async function submit() {
    if (submitting) return;
    if (energy === null) {
      setError("Tap where your energy is today and you're set.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setEarned(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("You're not signed in. Please reload and try again.");
        return;
      }
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          energy_score: energy,
          sleep_hours: sleepHours,
          training_logged: trainingLogged,
          nutrition_note: note,
          exercises: trainingLogged ? exercises : [],
        }),
      });
      const data = (await res.json()) as CheckinState & {
        pointsAwarded?: number;
        rankUp?: Rank | null;
        error?: string;
      };
      if (!res.ok || !data.checkin) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setState((prev) => {
        // Today's heatmap cell reflects what was just saved, without a refetch.
        const last30 = [...(prev?.last30 ?? Array<DayStatus>(30).fill("n"))];
        last30[last30.length - 1] = sleepHours == null ? "p" : "g";
        return {
          checkin: data.checkin,
          checkedInToday: true,
          streak: data.streak,
          pointsBalance: data.pointsBalance,
          ikiScore: data.ikiScore ?? prev?.ikiScore,
          last30,
          pointsToday: (prev?.pointsToday ?? 0) + (data.pointsAwarded ?? 0),
        };
      });
      setEditing(false);
      // Only ever set when this check-in actually crossed a boundary, so the
      // celebration cannot fire twice for the same rank.
      if (data.rankUp) setRankUp(data.rankUp);
      setEarned(data.pointsAwarded ?? 0);
      setJustSaved(true);
      // Offer the card on the win itself, as a modal, inline it sat below the
      // fold of a long form and went unseen. Done here rather than in an effect
      // on `justSaved`: `loadInviteCode` changes identity once it sets the
      // code, so an effect would re-fire and re-open a sheet the user closed.
      setShareModal(true);
      void loadInviteCode();
      onChange?.();
    } catch (err) {
      console.error("Check-in submit failed:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * The invite code that rides on every shared card. Fetched only when the
   * share sheet is opened, most check-ins never open it, and a card without
   * a code still works (it just shows the bare link).
   */
  const loadInviteCode = useCallback(async () => {
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

  const shareInput = useMemo(
    () => ({
      streak: state?.streak ?? 0,
      pointsBalance: state?.pointsBalance ?? 0,
      pointsEarned: earned ?? 0,
      trainingLogged,
      // Human labels only, the card never prints internal type keys.
      activities: exercises.map((e) =>
        e.type === OTHER_TYPE
          ? e.label || "Other"
          : isExerciseType(e.type)
            ? EXERCISE_TYPE_LABELS[e.type]
            : e.type,
      ),
      // Type keys, for choosing the default backdrop. Never drawn.
      exerciseTypes: exercises.map((e) => e.type),
      energy,
      sleepHours,
      inviteCode,
      date: new Date(),
    }),
    [
      state?.streak,
      state?.pointsBalance,
      earned,
      trainingLogged,
      exercises,
      energy,
      sleepHours,
      inviteCode,
    ],
  );

  if (status === "loading") {
    return <p className="text-body-sm text-muted">Loading your check-in…</p>;
  }
  if (status === "error") {
    return (
      <div className="flex w-full max-w-md flex-col gap-4">
        <p className="text-body-sm text-muted">Couldn&rsquo;t load your check-in.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="iki-btn iki-btn-primary w-full"
        >
          Try again
        </button>
      </div>
    );
  }

  const checkedInToday = state?.checkedInToday ?? false;
  const mode: CheckinMode = checkedInToday && !editing ? "saved" : "form";

  // Favourites first (the member's profile activities), then the rest behind
  // "All N activities". Anything already selected always shows, so a logged
  // activity can always be deselected. "Other" is always last.
  const favourites: string[] = activities.filter(isExerciseType);
  const selectedTypes = exercises.map((e) => e.type);
  const showAll = showAllActivities || favourites.length === 0;
  const tileTypes = [
    ...(showAll ? [...EXERCISE_TYPES] : favourites),
    ...selectedTypes.filter(
      (t) => t !== OTHER_TYPE && isExerciseType(t) && !showAll && !favourites.includes(t),
    ),
    OTHER_TYPE,
  ];
  const nameOf = (type: string, label?: string | null) =>
    type === OTHER_TYPE ? label || "Other" : EXERCISE_TYPE_LABELS[type as ExerciseType] ?? type;
  const needsDuration = exercises.filter(
    (e) => e.duration == null || (e.type === OTHER_TYPE && !e.label),
  );

  const status_ = (
    /* Announced rather than only shown. Saving a check-in swaps the whole view,
       which a screen reader would not mention on its own. */
    <p role="status" aria-live="polite" className="sr-only">
      {submitting
        ? "Saving your check-in."
        : justSaved
          ? earned && earned > 0
            ? `Saved. You earned ${earned} iki points.`
            : "Saved. See you tomorrow."
          : ""}
    </p>
  );

  /* ------------------------------ saved view ------------------------------ */

  if (mode === "saved") {
    const earnedToday = earned ?? state?.pointsToday ?? 0;
    const progress = rankProgress(state?.ikiScore ?? 0);
    const streak = state?.streak ?? 0;
    return (
      <div className="flex w-full max-w-md flex-col gap-stack">
        <ModeReporter mode={mode} onModeChange={onModeChange} />
        <header className="flex flex-col gap-1.5">
          <p className="iki-eyebrow">Daily check-in</p>
          <h1 className="iki-title">Checked in.</h1>
        </header>
        {status_}

        {rankUp && <RankUpToast rank={rankUp} onClose={() => setRankUp(null)} />}

        <section className="iki-card iki-celebrate flex flex-col items-center gap-4 py-6">
          <span className="iki-celebrate-check" aria-hidden>
            <Icon name="check" size={30} strokeWidth={2.5} />
          </span>
          {earnedToday > 0 && (
            <p className="font-display text-display-hero text-primary">
              +{earnedToday}
              <span className="ml-1 font-sans text-unit">iki</span>
            </p>
          )}
          <p className="text-caption text-muted">
            Streak now{" "}
            <strong className="font-semibold text-ink">
              {streak} {streak === 1 ? "day" : "days"}
            </strong>
            {progress.next &&
              ` · ${progress.remaining.toLocaleString("en-US")} iki to ${progress.next.name}`}
          </p>
          <div className="w-full">
            <Heatmap days={state?.last30 ?? Array<DayStatus>(30).fill("n")} legend={false} />
          </div>

          {showShare ? (
            <div className="w-full text-left">
              <ShareCheckinCard input={shareInput} onClose={() => setShowShare(false)} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowShare(true);
                void loadInviteCode();
              }}
              className="iki-btn iki-btn-ceremonial"
            >
              Share your streak
            </button>
          )}
        </section>

        <section className="iki-card flex flex-col">
          <p className="iki-eyebrow pb-2">Logged today</p>
          <LoggedRow color="var(--pillar-performance)" label="Energy"
            value={energy ? `${ENERGY_LABELS[energy]} · ${energy}` : "-"} />
          <LoggedRow color="var(--pillar-recovery)" label="Sleep"
            value={sleepHours != null ? `${sleepHours} h` : "Not logged"} />
          {trainingLogged &&
            exercises.map((e) => (
              <LoggedRow
                key={e.type}
                color={`var(--pillar-${pillarForActivity(e.type)})`}
                label={nameOf(e.type, e.label)}
                value={e.duration ? DURATION_LABELS[e.duration] : "-"}
              />
            ))}
        </section>

        <button type="button" onClick={() => setEditing(true)} className="iki-btn iki-btn-secondary w-full">
          Update check-in
        </button>
        <p className="text-center text-micro text-muted">
          Come back tomorrow to keep the streak alive.
        </p>

        {shareModal && <ShareModal input={shareInput} onClose={() => setShareModal(false)} />}
      </div>
    );
  }

  /* ------------------------------- form view ------------------------------ */

  return (
    <div className="flex w-full max-w-md flex-col gap-stack">
      <ModeReporter mode={mode} onModeChange={onModeChange} />
      <header className="flex flex-col gap-1.5">
        <p className="iki-eyebrow">Daily check-in</p>
        <h1 className="iki-title">
          {checkedInToday ? "Today's check-in" : "How are you feeling today?"}
        </h1>
      </header>
      {status_}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-stack"
      >
        <section className="iki-card flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="iki-eyebrow">Energy</p>
            <p className="font-display text-display-md text-pillar-performance">
              {energy ? ENERGY_LABELS[energy] : "Not set"}
            </p>
          </div>
          <EnergyScale
            value={energy}
            onChange={(v) => {
              setEnergy(v);
              markEdited();
            }}
          />
        </section>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2.5">
          <section className="iki-card flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="iki-glyph-well bg-pillar-recovery" aria-hidden>
                <Icon name="moon" size={13} strokeWidth={2} />
              </span>
              <p className="iki-eyebrow">Sleep</p>
            </div>
            <SleepStepper
              value={sleepHours}
              onChange={(v) => {
                setSleepHours(v);
                markEdited();
              }}
            />
          </section>
          <section className="iki-card flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="iki-glyph-well bg-pillar-performance" aria-hidden>
                <Icon name="flame" size={13} strokeWidth={2} />
              </span>
              <p className="iki-eyebrow">Trained</p>
            </div>
            <p className="font-display text-display-md text-ink">{trainingLogged ? "Yes" : "No"}</p>
            <div className="mt-auto">
              <Switch
                checked={trainingLogged}
                label="Did you train today?"
                onChange={(v) => {
                  setTrainingLogged(v);
                  markEdited();
                }}
              />
            </div>
          </section>
        </div>

        {trainingLogged && (
          <section className="flex flex-col gap-3" aria-label="What you did">
            <div className="flex items-baseline justify-between gap-3">
              <p className="iki-eyebrow">What you did</p>
              {exercises.length > 0 && (
                <p className="text-micro text-muted">
                  {exercises.length} selected
                  {needsDuration.length > 0 && ` · ${needsDuration.length} needs a duration`}
                </p>
              )}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2.5">
              {tileTypes.map((type) => {
                const entry = exercises.find((e) => e.type === type);
                return (
                  <ActivityTile
                    key={type}
                    type={type}
                    label={nameOf(type)}
                    selected={!!entry}
                    duration={entry?.duration ?? null}
                    onToggle={() => toggleExercise(type)}
                  />
                );
              })}
            </div>

            {needsDuration.map((e) => {
              const name = nameOf(e.type);
              return (
                <div key={e.type} className="iki-card iki-card-tight flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-body-sm font-semibold text-ink">{name} · how long?</span>
                    <button
                      type="button"
                      onClick={() => toggleExercise(e.type)}
                      className="iki-btn-link iki-tap"
                    >
                      Remove
                    </button>
                  </div>
                  {e.type === OTHER_TYPE && (
                    <input
                      className={fieldClass}
                      value={e.label ?? ""}
                      onChange={(ev) => setOtherLabel(ev.target.value)}
                      maxLength={60}
                      placeholder="What did you do?"
                      aria-label="What did you do?"
                    />
                  )}
                  <DurationSegmented
                    label={`How long: ${name}`}
                    value={e.duration}
                    onChange={(b) => setDuration(e.type, b)}
                  />
                </div>
              );
            })}

            {!showAll && (
              <button
                type="button"
                onClick={() => setShowAllActivities(true)}
                className="iki-btn iki-btn-secondary w-full"
              >
                All {EXERCISE_TYPES.length} activities
                <Icon name="chevron-right" size={16} strokeWidth={2} />
              </button>
            )}
          </section>
        )}

        <section className="iki-card flex flex-col gap-2">
          <label htmlFor="nutrition-note" className="iki-eyebrow">
            Nutrition note
          </label>
          <textarea
            id="nutrition-note"
            className={`${fieldClass} h-auto min-h-20 resize-y py-2`}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              markEdited();
            }}
            maxLength={500}
            placeholder="Anything about food today? Totally optional."
          />
        </section>

        {error && (
          <p role="alert" className="text-body-sm text-primary-deep">
            {error}
          </p>
        )}

        <div className="flex flex-col items-center gap-2.5">
          <HoldToSubmit
            label={checkedInToday ? "Hold to update" : "Hold to check in"}
            busy={submitting}
            onFire={() => void submit()}
          />
          {!checkedInToday && (
            <p className="text-micro uppercase tracking-[0.1em] text-muted">
              First check-in of the day ·{" "}
              <span className="font-semibold text-primary">+{POINTS.checkin} iki</span>
            </p>
          )}
        </div>
      </form>

      {shareModal && <ShareModal input={shareInput} onClose={() => setShareModal(false)} />}
    </div>
  );
}

/** One line of the "Logged today" card: a pillar dot, a label, a value. */
function LoggedRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-t border-line py-2.5">
      <span className="iki-pillar-dot" style={{ background: color }} aria-hidden />
      <span className="flex-1 text-body-sm text-ink">{label}</span>
      <span className="text-body-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

/** Tells the shell which view is up, so its header link reads right. */
function ModeReporter({
  mode,
  onModeChange,
}: {
  mode: CheckinMode;
  onModeChange?: (mode: CheckinMode) => void;
}) {
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);
  return null;
}
