"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type CheckinRow,
  ENERGY_LABELS,
  MAX_ENERGY,
  MIN_ENERGY,
} from "@/lib/checkin";
import {
  DURATION_BUCKETS,
  DURATION_HINTS,
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
  Card,
  Eyebrow,
  fieldClass,
  labelClass,
  PageHeader,
  primaryButtonClass,
} from "./ui";

interface CheckinState {
  checkin: CheckinRow | null;
  checkedInToday: boolean;
  streak: number;
  pointsBalance: number;
}

const ENERGY_VALUES = Array.from(
  { length: MAX_ENERGY - MIN_ENERGY + 1 },
  (_, i) => MIN_ENERGY + i,
);

/**
 * The Daily Check-in tab: a 30-second flow (energy, sleep, training, a note)
 * that earns iki points on the day's first submission. Loads today's status
 * from GET /api/checkin and writes via POST.
 */
export function CheckinForm({
  getToken,
  activities,
  onChange,
}: {
  getToken: () => Promise<string | null>;
  activities: string[];
  onChange?: () => void;
}) {
  const [state, setState] = useState<CheckinState | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [energy, setEnergy] = useState<number | null>(null);
  const [sleepHours, setSleepHours] = useState("");
  const [trainingLogged, setTrainingLogged] = useState(false);
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earned, setEarned] = useState<number | null>(null);
  const [justSaved, setJustSaved] = useState(false);
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
    setSleepHours(c?.sleep_hours != null ? String(c.sleep_hours) : "");
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (energy === null) {
      setError("Pick your energy level to check in.");
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
          sleep_hours: sleepHours === "" ? null : Number(sleepHours),
          training_logged: trainingLogged,
          nutrition_note: note,
          exercises: trainingLogged ? exercises : [],
        }),
      });
      const data = (await res.json()) as CheckinState & {
        pointsAwarded?: number;
        error?: string;
      };
      if (!res.ok || !data.checkin) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setState({
        checkin: data.checkin,
        checkedInToday: true,
        streak: data.streak,
        pointsBalance: data.pointsBalance,
      });
      setEarned(data.pointsAwarded ?? 0);
      setJustSaved(true);
      onChange?.();
    } catch (err) {
      console.error("Check-in submit failed:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return <p className="font-body text-sm text-muted">Loading your check-in…</p>;
  }
  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-body text-sm text-muted">
          Couldn&rsquo;t load your check-in.
        </p>
        <button onClick={() => void load()} className={primaryButtonClass}>
          Try again
        </button>
      </div>
    );
  }

  const checkedInToday = state?.checkedInToday ?? false;
  // Show the user's usual activities as quick options; fall back to the full
  // list if they haven't set any. "Other" is always available.
  const activityOptions: string[] =
    activities.length > 0 ? activities.filter(isExerciseType) : [...EXERCISE_TYPES];
  const selectedTypes = exercises.map((e) => e.type);
  // Always show a chip for anything already logged today, even if it's no longer
  // one of the user's profile activities — otherwise a logged activity can't be
  // deselected.
  const chipTypes = [
    ...activityOptions,
    ...selectedTypes.filter(
      (t) => t !== OTHER_TYPE && isExerciseType(t) && !activityOptions.includes(t),
    ),
  ];

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <PageHeader
        eyebrow="Daily Check-in"
        title={checkedInToday ? "Today's check-in" : "How are you today?"}
        subtitle="A few seconds to log how you feel. Your first check-in each day earns iki points."
      />

      <div className="grid grid-cols-2 gap-4">
        <Card className="flex flex-col gap-1 p-5">
          <Eyebrow>Streak</Eyebrow>
          <p className="font-display text-2xl font-medium text-foreground">
            {state?.streak ?? 0}
            <span className="ml-1 font-body text-sm text-muted">
              {state?.streak === 1 ? "day" : "days"}
            </span>
          </p>
        </Card>
        <Card className="flex flex-col gap-1 p-5">
          <Eyebrow>iki points</Eyebrow>
          <p className="font-display text-2xl font-medium text-foreground">
            {state?.pointsBalance ?? 0}
          </p>
        </Card>
      </div>

      {justSaved && (
        <Card className="border-accent/40 bg-surface-2 p-4">
          <p className="font-body text-sm font-medium text-foreground">
            {earned && earned > 0
              ? `Done ✓ You're checked in for today and earned ${earned} iki points.`
              : "Done ✓ Your check-in has been updated."}
          </p>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className={labelClass}>
          <span>Energy</span>
          <div className="grid grid-cols-5 gap-2">
            {ENERGY_VALUES.map((v) => {
              const selected = energy === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setEnergy(v);
                    markEdited();
                  }}
                  aria-pressed={selected}
                  title={ENERGY_LABELS[v]}
                  className={`flex h-11 items-center justify-center rounded-control border text-sm font-medium transition-colors ${
                    selected
                      ? "border-accent bg-accent text-accent-contrast"
                      : "border-border bg-surface text-foreground hover:border-accent/50"
                  }`}
                >
                  {v}
                </button>
              );
            })}
          </div>
          {energy !== null && (
            <span className="text-xs font-normal text-muted">
              {ENERGY_LABELS[energy]}
            </span>
          )}
        </div>

        <label className={labelClass}>
          Sleep last night (hours)
          <input
            className={fieldClass}
            type="number"
            inputMode="decimal"
            min={0}
            max={24}
            step={0.5}
            value={sleepHours}
            onChange={(e) => {
              setSleepHours(e.target.value);
              markEdited();
            }}
            placeholder="e.g. 7.5"
          />
        </label>

        <div className="flex flex-col gap-3 font-body">
          <label className="flex items-start gap-2.5 text-sm text-muted">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-accent"
              checked={trainingLogged}
              onChange={(e) => {
                setTrainingLogged(e.target.checked);
                markEdited();
              }}
            />
            I trained today.
          </label>

          {trainingLogged && (
            <div className="flex flex-col gap-3">
              <span className="text-xs text-muted">
                Tap what you did, then set how long.
              </span>
              <div className="flex flex-wrap gap-2">
                {[...chipTypes, OTHER_TYPE].map((type) => {
                  const on = selectedTypes.includes(type);
                  const label =
                    type === OTHER_TYPE
                      ? "Other"
                      : EXERCISE_TYPE_LABELS[type as ExerciseType];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleExercise(type)}
                      aria-pressed={on}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                        on
                          ? "border-accent bg-accent text-accent-contrast"
                          : "border-border bg-surface text-foreground hover:border-accent/50"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {exercises.map((e) => (
                <div
                  key={e.type}
                  className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {e.type === OTHER_TYPE
                        ? "Other"
                        : EXERCISE_TYPE_LABELS[e.type as ExerciseType]}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleExercise(e.type)}
                      className="text-xs text-muted underline transition-colors hover:text-foreground"
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
                    />
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    {DURATION_BUCKETS.map((b) => {
                      const on = e.duration === b;
                      return (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setDuration(e.type, b)}
                          aria-pressed={on}
                          className={`flex h-10 flex-col items-center justify-center rounded-control border text-xs transition-colors ${
                            on
                              ? "border-accent bg-accent text-accent-contrast"
                              : "border-border bg-surface text-foreground hover:border-accent/50"
                          }`}
                        >
                          <span className="text-sm font-medium">
                            {DURATION_LABELS[b]}
                          </span>
                          <span className="opacity-70">{DURATION_HINTS[b]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className={labelClass}>
          Nutrition note
          <textarea
            className={`${fieldClass} h-auto min-h-20 resize-y py-2`}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              markEdited();
            }}
            maxLength={500}
            placeholder="Anything worth noting about food today (optional)."
          />
        </label>

        {error && <p className="font-body text-sm text-accent-hover">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className={`${primaryButtonClass} w-full`}
        >
          {submitting
            ? "Saving…"
            : justSaved
              ? "Done ✓"
              : checkedInToday
                ? "Update check-in"
                : "Check in"}
        </button>
      </form>
    </div>
  );
}
