import {
  DURATION_MINUTES,
  EXERCISE_TYPE_LABELS,
  type ExerciseEntry,
  isDurationBucket,
  isExerciseType,
  matchExerciseType,
} from "./exercises";
import type { MergedSeries } from "./wearables/merge";

/**
 * Training load and recovery.
 *
 * WHY THIS IS NOT A BIOMARKER CORRELATION. The obvious thing to build from
 * workout data is "training moved your lipids", and there is no honest way to
 * say that yet. The path from a session to a marker runs through behaviour,
 * training drives eating, sleeping and hydrating, and it moves markers over a
 * panel cycle of roughly six months. Demonstrating it needs paired training and
 * panel data six months apart from the same person, which nobody has, us
 * included. The reasoning is in docs/WEARABLE_DATA.md.
 *
 * WHAT IS HONEST TODAY is the near half of that chain: how hard the last week
 * was, and whether the body is absorbing it. Both are visible in data we
 * already hold, and neither requires a claim we cannot support.
 *
 * SO THIS FILE PRODUCES A DESCRIPTION, NOT A PRESCRIPTION. It says what
 * happened and whether recovery markers moved with it. It does not tell anyone
 * to train, rest, or expect a marker to change. Everything here is a comparison
 * of a person against their own recent baseline, never against a population.
 *
 * WHY IT SITS HERE AND NOT UNDER wearables/. It used to, and that was wrong:
 * living in that folder implied a ring was required, and the first version read
 * nothing but wearable sessions. In a beta where nobody has connected a device
 * yet, that is a card which renders for zero people. The check-in has logged
 * activities with a duration since migration 0003, from everyone, every day.
 * That is the primary source; a device upgrades it from reported to measured.
 */

/** One stored session from a device, as the training view needs it. */
export interface WorkoutRow {
  workout_date: string;
  started_at: string;
  ended_at: string;
  activity?: string | null;
  /** Whoop only, 0-21. Never comparable to another vendor's number. */
  strain?: number | string | null;
  provider: string;
  /**
   * The device noticed this rather than the member starting it. Movement, not
   * training. See `MOVEMENT` below for why the two are never added together.
   */
  auto_detected?: boolean | null;
}

/**
 * What a device picked up without being asked.
 *
 * KEPT APART FROM TRAINING ON PURPOSE, and shown rather than hidden. A walk to
 * the station is not a workout, and pretending it is would hand somebody seven
 * training days for a week they trained none. It is also not nothing:
 * everyday movement acts on bone, muscle, gut and metabolic health, and this
 * app is a wellness picture rather than a gym log.
 *
 * So both numbers exist and neither borrows the other's meaning.
 */
export interface MovementLoad {
  sessions: number;
  days: number;
  minutes: number;
}

/** One daily check-in, as the training view needs it. */
export interface CheckinTrainingRow {
  checkin_date: string;
  training_logged?: boolean | null;
  exercises?: ExerciseEntry[] | null;
  energy_score?: number | null;
  sleep_hours?: number | string | null;
}

/** Where a day's facts came from. Shown, because the difference matters. */
export type TrainingSource = "checkin" | "device";

export interface TrainingLoad {
  /** Sessions inside the window. */
  sessions: number;
  /** Distinct days trained, which is the number people actually recognise. */
  days: number;
  /** Total minutes across sessions. */
  minutes: number;
  /**
   * True when any day's minutes came from a check-in duration bucket rather
   * than a measured start and end. The UI says "about" when this is set: a
   * bucket is a guess we made on the user's behalf, and rendering it as a
   * precise total would present our arithmetic as their data.
   */
  minutesEstimated: boolean;
  /** Distinct activities, most frequent first. */
  activities: string[];
  /** Days in the window that had no session at all. */
  restDays: number;
  /** Which sources contributed a day, in a stable order. */
  sources: TrainingSource[];
  /**
   * Sessions the device noticed rather than the member starting. Counted
   * separately and never folded into the numbers above.
   */
  movement: MovementLoad;
}

/**
 * One activity, as both a thing to count and a thing to print.
 *
 * THE TWO ARE NOT THE SAME STRING, and that is the point. `key` is what decides
 * whether a ring's "Weight Training" and a check-in's "Gym / Weights" are the
 * same activity; `label` is what the user reads. Keying on the display text
 * showed one gym hour as two chips.
 */
interface ActivityRef {
  key: string;
  label: string;
  fromCheckin: boolean;
}

/** What one day looked like from one source. */
interface DayFacts {
  sessions: number;
  minutes: number;
  activities: ActivityRef[];
}

/** The key for an activity we could not place in our own taxonomy. */
function rawKey(name: string): string {
  return `raw:${name.toLowerCase()}`;
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Minutes between two ISO timestamps, or null if either is unusable. */
function durationMinutes(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 60_000);
}

/** The first day of the window ending at `endDate`, or null if unusable. */
function windowStart(endDate: string, windowDays: number): string | null {
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(endMs)) return null;
  return new Date(endMs - (windowDays - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** One logged check-in activity, as something to count and to print. */
function checkinActivity(e: ExerciseEntry): ActivityRef | null {
  if (isExerciseType(e.type)) {
    return { key: e.type, label: EXERCISE_TYPE_LABELS[e.type], fromCheckin: true };
  }
  // "other" carries its own free text; without one there is nothing to show.
  const label = (e.label ?? "").trim();
  return label ? { key: rawKey(label), label, fromCheckin: true } : null;
}

/**
 * One device session's activity.
 *
 * The vendor's own word is kept for display and only the KEY is normalised, so
 * "Padel" stays "Padel" on screen while still colliding with a check-in logged
 * as "Racquet & team sports". Collapsing the label too would trade a specific
 * word the vendor gave us for a vaguer one of ours.
 */
function deviceActivity(raw: string): ActivityRef {
  const matched = matchExerciseType(raw);
  return { key: matched ?? rawKey(raw), label: raw, fromCheckin: false };
}

/** Group device sessions by day. Auto-detected ones are excluded. */
function deviceDays(workouts: WorkoutRow[]): Map<string, DayFacts> {
  const out = new Map<string, DayFacts>();
  for (const w of workouts) {
    if (w.auto_detected === true) continue;
    const day = out.get(w.workout_date) ?? { sessions: 0, minutes: 0, activities: [] };
    day.sessions += 1;
    day.minutes += durationMinutes(w.started_at, w.ended_at) ?? 0;
    const a = (w.activity ?? "").trim();
    if (a) day.activities.push(deviceActivity(a));
    out.set(w.workout_date, day);
  }
  return out;
}

/** Roll up the sessions the device noticed rather than the member starting. */
function movementLoad(workouts: WorkoutRow[]): MovementLoad {
  const auto = workouts.filter((w) => w.auto_detected === true);
  return {
    sessions: auto.length,
    days: new Set(auto.map((w) => w.workout_date)).size,
    minutes: auto.reduce(
      (sum, w) => sum + (durationMinutes(w.started_at, w.ended_at) ?? 0),
      0,
    ),
  };
}

/**
 * Group check-in activities by day.
 *
 * A check-in with `training_logged` and no activity list is still a training
 * day. It is the older shape of the data, the tick box predates the activity
 * chips by a migration, and dropping those days would quietly erase the
 * training history of anyone who used the app before 0003.
 */
function checkinDays(checkins: CheckinTrainingRow[]): Map<string, DayFacts> {
  const out = new Map<string, DayFacts>();
  for (const c of checkins) {
    const entries = (c.exercises ?? []).filter(
      (e): e is ExerciseEntry => !!e && typeof e === "object",
    );
    if (entries.length === 0 && c.training_logged !== true) continue;

    const day = out.get(c.checkin_date) ?? { sessions: 0, minutes: 0, activities: [] };
    day.sessions += Math.max(entries.length, 1);
    for (const e of entries) {
      // An activity logged without a duration is a real session with no
      // volume. Counting it as zero minutes is honest; inventing a median
      // would put a number on the screen the user never gave us.
      if (isDurationBucket(e.duration)) day.minutes += DURATION_MINUTES[e.duration];
      const activity = checkinActivity(e);
      if (activity) day.activities.push(activity);
    }
    out.set(c.checkin_date, day);
  }
  return out;
}

/**
 * Summarise the training inside a window ending at `endDate` inclusive.
 *
 * COUNTS DAYS AS WELL AS SESSIONS, because they answer different questions and
 * people mean the second. "I trained four times this week" is days; a double
 * session on Tuesday is one training day and two sessions, and reporting it as
 * four would flatter the number in exactly the way a habit app must not.
 *
 * THE TWO SOURCES ARE RECONCILED PER DAY, NEVER ADDED. Someone who logs "gym"
 * in their check-in and whose ring recorded the same hour has trained once, and
 * summing the sources would tell them they trained twice. For each day the
 * session count is the higher of the two views, and the minutes come from the
 * device whenever it recorded any, because that is measured where the bucket is
 * estimated. It is the rule the biomarker merge already uses: prefer whatever
 * measured the quantity directly.
 *
 * WHAT THE DEVICE NOTICED IS NOT TRAINING and comes back under `movement`. A
 * watch logging a walk to the station is real and worth showing; calling it a
 * training day is how somebody ends up with seven out of seven for a week they
 * trained none.
 */
export function trainingLoad(
  input: { workouts?: WorkoutRow[]; checkins?: CheckinTrainingRow[] },
  endDate: string,
  windowDays = 7,
): TrainingLoad {
  const from = windowStart(endDate, windowDays);
  const noMovement: MovementLoad = { sessions: 0, days: 0, minutes: 0 };
  const empty: TrainingLoad = {
    sessions: 0,
    days: 0,
    minutes: 0,
    minutesEstimated: false,
    activities: [],
    restDays: from === null ? 0 : windowDays,
    sources: [],
    movement: noMovement,
  };
  if (from === null) return empty;

  const inWindow = <T,>(rows: T[], date: (r: T) => string) =>
    rows.filter((r) => date(r) >= from && date(r) <= endDate);

  const workoutsInWindow = inWindow(input.workouts ?? [], (w) => w.workout_date);
  const fromDevice = deviceDays(workoutsInWindow);
  const fromCheckin = checkinDays(inWindow(input.checkins ?? [], (c) => c.checkin_date));
  const movement = movementLoad(workoutsInWindow);

  const allDays = new Set([...fromDevice.keys(), ...fromCheckin.keys()]);
  // A week of nothing but walks is still a week with something to say, so the
  // movement roll-up survives the early return.
  if (allDays.size === 0) return { ...empty, movement };

  let sessions = 0;
  let minutes = 0;
  let minutesEstimated = false;
  /** Days on which each activity appeared, so one activity counts once a day. */
  const activityDays = new Map<string, { label: string; days: number; fromCheckin: boolean }>();

  for (const day of allDays) {
    const d = fromDevice.get(day);
    const c = fromCheckin.get(day);

    // The higher of the two views, not the sum. See the note above.
    sessions += Math.max(d?.sessions ?? 0, c?.sessions ?? 0);

    if (d && d.minutes > 0) {
      minutes += d.minutes;
    } else if (c && c.minutes > 0) {
      minutes += c.minutes;
      minutesEstimated = true;
    }

    // Union the activities: a ring recording a run and a check-in logging
    // weights on the same day are two real activities, not a contradiction to
    // resolve. The same activity seen by both is one, which is what the
    // normalised key is for.
    //
    // WHEN BOTH NAMED IT, THE DEVICE'S WORD WINS. It observed the session where
    // the check-in recalled it, which is the same reason its minutes win, and
    // its word is usually the more specific one: a ring reporting "Padel"
    // against a check-in bucketed as "Racquet & team sports" is the case that
    // decided this.
    const perDay = new Map<string, ActivityRef>();
    for (const a of [...(d?.activities ?? []), ...(c?.activities ?? [])]) {
      const seen = perDay.get(a.key);
      if (!seen || (seen.fromCheckin && !a.fromCheckin)) perDay.set(a.key, a);
    }

    for (const [key, ref] of perDay) {
      const prev = activityDays.get(key);
      const takeLabel = !prev || (prev.fromCheckin && !ref.fromCheckin);
      activityDays.set(key, {
        label: takeLabel ? ref.label : prev.label,
        days: (prev?.days ?? 0) + 1,
        // Only true while every sighting has come from a check-in, so the
        // first device sighting can still upgrade the wording.
        fromCheckin: (prev?.fromCheckin ?? true) && ref.fromCheckin,
      });
    }
  }

  const activities = [...activityDays.values()]
    .sort((x, y) => y.days - x.days || x.label.localeCompare(y.label))
    .map((a) => a.label);

  const sources: TrainingSource[] = [];
  if (fromCheckin.size > 0) sources.push("checkin");
  if (fromDevice.size > 0) sources.push("device");

  return {
    sessions,
    days: allDays.size,
    minutes,
    minutesEstimated,
    activities,
    // Rest is measured against training only. A day spent walking is not a
    // training day, and calling it one would quietly undo the whole point of
    // keeping the two apart.
    restDays: Math.max(0, windowDays - allDays.size),
    sources,
    movement,
  };
}

export type RecoveryDirection = "recovering" | "holding" | "straining" | "unknown";

/**
 * Measured means a device read the body. Reported means the person told us how
 * they felt. Both are worth showing and they are not the same claim, so the
 * card never presents one as the other.
 */
export type RecoverySource = "measured" | "reported";

export interface RecoverySignal {
  direction: RecoveryDirection;
  /** Null when direction is "unknown", because nothing supplied an answer. */
  source: RecoverySource | null;
  /** Which metrics actually contributed. Empty when direction is "unknown". */
  basis: string[];
  /**
   * Plain-language summary. Descriptive, never advice: this file does not tell
   * anyone to rest, and a health app saying "take a day off" is a
   * recommendation it is not qualified to make.
   */
  summary: string;
}

const UNKNOWN: RecoverySignal = {
  direction: "unknown",
  source: null,
  basis: [],
  summary: "Not enough data yet to say how recovery is going.",
};

/** Mean of the last `days` values of a series, newest-first agnostic. */
function windowMean(
  series: MergedSeries | undefined,
  endDate: string,
  days: number,
): number | null {
  if (!series || series.points.length === 0) return null;
  const from = windowStart(endDate, days);
  if (from === null) return null;
  const vals = series.points
    .filter((p) => p.date >= from && p.date <= endDate)
    .map((p) => p.value);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** The last day of the window immediately before the one ending at `endDate`. */
function priorWindowEnd(endDate: string, recentDays: number): string | null {
  const ms = Date.parse(`${endDate}T00:00:00Z`) - recentDays * 86_400_000;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Turns a pair of window means into a vote, or 0 when the move is too small. */
function voteOn(
  now: number | null,
  before: number | null,
  betterWhenHigher: boolean,
  minMove: number,
): number | null {
  if (now === null || before === null) return null;
  const move = now - before;
  if (Math.abs(move) < minMove) return 0;
  return move > 0 === betterWhenHigher ? 1 : -1;
}

/**
 * Is the body absorbing the recent load, compared with the fortnight before it?
 *
 * READS THREE MARKERS AND REQUIRES TWO TO AGREE. HRV up, resting heart rate
 * down and readiness up all point the same way; any one of them alone is noise,
 * since HRV in particular swings with alcohol, illness and a late meal. Needing
 * two makes the signal quiet rather than chatty, which is correct for something
 * a person reads about their own body.
 *
 * THRESHOLDS ARE PERCENTAGES OF THE PERSON'S OWN BASELINE, never population
 * ranges. A resting heart rate of 58 is unremarkable in isolation and means
 * something if yours is normally 51.
 */
export function recoverySignal(
  byMetric: Map<string, MergedSeries>,
  endDate: string,
  recentDays = 7,
): RecoverySignal {
  // The prior window is the same length, immediately before the recent one, so
  // a quiet fortnight is never measured against a busy week.
  const priorEnd = priorWindowEnd(endDate, recentDays);
  if (priorEnd === null) return UNKNOWN;

  /** +1 when the marker moved the recovering way, -1 the straining way. */
  const vote = (metric: string, betterWhenHigher: boolean, minPct: number): number | null => {
    const series = byMetric.get(metric);
    const now = windowMean(series, endDate, recentDays);
    const before = windowMean(series, priorEnd, recentDays);
    if (now === null || before === null || before === 0) return null;
    // Expressed against the person's own baseline, so one rule serves an HRV
    // of 30 and an HRV of 120.
    const pct = ((now - before) / Math.abs(before)) * 100;
    return voteOn(pct, 0, betterWhenHigher, minPct);
  };

  // Minimums are deliberately different. Resting heart rate is stable enough
  // that 3% is a real move; HRV is noisy enough that under 5% is nothing.
  const votes: [string, number | null][] = [
    ["HRV", vote("hrv", true, 5)],
    ["resting heart rate", vote("resting_heart_rate", false, 3)],
    ["readiness", vote("readiness_score", true, 3)],
  ];

  const counted = votes.filter(([, v]) => v !== null);
  if (counted.length < 2) return UNKNOWN;

  const score = counted.reduce((sum, [, v]) => sum + (v ?? 0), 0);
  const basis = counted.filter(([, v]) => v !== 0).map(([name]) => name);

  if (score >= 2) {
    return {
      direction: "recovering",
      source: "measured",
      basis,
      summary: `Your ${basis.join(" and ")} improved on the previous ${recentDays} days.`,
    };
  }
  if (score <= -2) {
    return {
      direction: "straining",
      source: "measured",
      basis,
      summary: `Your ${basis.join(" and ")} moved the other way from the previous ${recentDays} days.`,
    };
  }
  return {
    direction: "holding",
    source: "measured",
    basis,
    summary: `Recovery markers are about where they were over the previous ${recentDays} days.`,
  };
}

/** Check-ins needed in EACH window before a reported comparison means anything. */
const MIN_CHECKINS_PER_WINDOW = 4;

/**
 * The same question asked of the check-in, for everyone without a device.
 *
 * WHY THIS EXISTS AT ALL. Recovery read from HRV is better, and almost nobody
 * has it. Energy and sleep have been in the check-in since day one, so this is
 * the version of the answer most people can actually see, and a card that only
 * speaks to ring owners speaks to nearly nobody.
 *
 * WHY THE RULE IS NOT THE MEASURED ONE. The device path demands two markers
 * agree because each is a proxy that swings on its own. Energy is not a proxy:
 * asked how recovered you feel, the answer IS the reported measure, and
 * requiring something else to confirm it would be demanding corroboration of
 * the primary source. So energy can carry the signal alone, and the bar is
 * raised elsewhere instead: four check-ins in each window, and half a point of
 * movement on a five point scale, which is a tenth of the whole range.
 *
 * IT IS NEVER PRESENTED AS THE MEASURED SIGNAL. `source` says "reported" and
 * the card says so in words. Self-report drifts with mood, and with how long
 * somebody has been using the app; a number derived from it must not be dressed
 * up as a reading taken off the body.
 */
export function reportedRecovery(
  checkins: CheckinTrainingRow[],
  endDate: string,
  recentDays = 7,
): RecoverySignal {
  const priorEnd = priorWindowEnd(endDate, recentDays);
  const recentFrom = windowStart(endDate, recentDays);
  if (priorEnd === null || recentFrom === null) return UNKNOWN;
  const priorFrom = windowStart(priorEnd, recentDays);
  if (priorFrom === null) return UNKNOWN;

  const inRange = (from: string, to: string) =>
    checkins.filter((c) => c.checkin_date >= from && c.checkin_date <= to);

  const recent = inRange(recentFrom, endDate);
  const prior = inRange(priorFrom, priorEnd);
  if (recent.length < MIN_CHECKINS_PER_WINDOW || prior.length < MIN_CHECKINS_PER_WINDOW) {
    return UNKNOWN;
  }

  const meanOf = (
    rows: CheckinTrainingRow[],
    pick: (c: CheckinTrainingRow) => number | null,
  ): number | null => {
    const vals = rows.map(pick).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const energy = voteOn(
    meanOf(recent, (c) => toNumber(c.energy_score)),
    meanOf(prior, (c) => toNumber(c.energy_score)),
    true,
    // Half a point on a 1-5 scale. Below that it is the difference between
    // "Okay" and "Okay on a slightly better morning".
    0.5,
  );
  const sleep = voteOn(
    meanOf(recent, (c) => toNumber(c.sleep_hours)),
    meanOf(prior, (c) => toNumber(c.sleep_hours)),
    true,
    // Half an hour. People report sleep rounded to the half hour anyway, so a
    // tighter threshold would be reading their rounding.
    0.5,
  );

  if (energy === null) return UNKNOWN;

  const basis: string[] = [];
  if (energy !== 0) basis.push("energy");
  if (sleep !== null && sleep !== 0) basis.push("sleep");

  // Energy leads. Sleep can agree with it or cancel it, never outvote it: the
  // question is how recovered the person feels, and sleep is an input to that
  // rather than a second opinion on it.
  const score = energy + (sleep ?? 0);
  // "energy and sleep are", "energy is". Getting this wrong is small and it is
  // the kind of small that makes a health app read like a form letter.
  const verb = basis.length > 1 ? "are" : "is";
  if (energy > 0 && score > 0) {
    return {
      direction: "recovering",
      source: "reported",
      basis,
      summary: `Your reported ${basis.join(" and ")} ${verb} up on the previous ${recentDays} days.`,
    };
  }
  if (energy < 0 && score < 0) {
    return {
      direction: "straining",
      source: "reported",
      basis,
      summary: `Your reported ${basis.join(" and ")} ${verb} down on the previous ${recentDays} days.`,
    };
  }
  return {
    direction: "holding",
    source: "reported",
    basis,
    summary: `How you have felt is about the same as the previous ${recentDays} days.`,
  };
}

/**
 * The recovery answer to show: measured where a device can give one, reported
 * otherwise.
 *
 * FALLS BACK RATHER THAN BLENDING. Averaging a reading off the body with
 * somebody's opinion of their morning produces a number that is neither, and
 * there is no defensible weighting between the two. One or the other, labelled.
 */
export function recoveryView(
  byMetric: Map<string, MergedSeries>,
  checkins: CheckinTrainingRow[],
  endDate: string,
  recentDays = 7,
): RecoverySignal {
  const measured = recoverySignal(byMetric, endDate, recentDays);
  if (measured.direction !== "unknown") return measured;
  return reportedRecovery(checkins, endDate, recentDays);
}
