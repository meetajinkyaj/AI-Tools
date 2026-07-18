/**
 * Intervention log: what the user changed (started a supplement, began strength
 * training, switched their diet). Captured from day one because it can't be
 * reconstructed later — it powers attribution ("what actually moved my LDL?").
 * Pure validation logic, shared by the API route and testable in isolation.
 */

export const INTERVENTION_TYPES = [
  "supplement",
  "diet",
  "training",
  "medication",
  "lifestyle",
  "other",
] as const;
export type InterventionType = (typeof INTERVENTION_TYPES)[number];

export const INTERVENTION_TYPE_LABELS: Record<InterventionType, string> = {
  supplement: "Supplement",
  diet: "Diet",
  training: "Training",
  medication: "Medication",
  lifestyle: "Lifestyle",
  other: "Other",
};

export interface InterventionInput {
  type: InterventionType;
  label: string;
  dose_note: string | null;
  started_at: string | null; // YYYY-MM-DD; null → server uses today
  ended_at: string | null;
}

const MAX_LABEL = 120;
const MAX_DOSE = 200;

export type InterventionValidation =
  | { ok: true; value: InterventionInput }
  | { ok: false; error: string };

/** Validate an untrusted intervention body. Never throws. */
export function validateInterventionInput(body: unknown): InterventionValidation {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  if (
    typeof b.type !== "string" ||
    !INTERVENTION_TYPES.includes(b.type as InterventionType)
  ) {
    return { ok: false, error: "Choose a valid type" };
  }
  const type = b.type as InterventionType;

  if (typeof b.label !== "string" || b.label.trim().length === 0) {
    return { ok: false, error: "Add what you changed" };
  }
  const label = b.label.trim().slice(0, MAX_LABEL);

  const doseNote =
    typeof b.dose_note === "string" && b.dose_note.trim().length > 0
      ? b.dose_note.trim().slice(0, MAX_DOSE)
      : null;

  const startedAt = optionalDate(b.started_at);
  if (b.started_at != null && b.started_at !== "" && startedAt === null) {
    return { ok: false, error: "Invalid start date" };
  }
  const endedAt = optionalDate(b.ended_at);
  if (b.ended_at != null && b.ended_at !== "" && endedAt === null) {
    return { ok: false, error: "Invalid end date" };
  }

  return {
    ok: true,
    value: { type, label, dose_note: doseNote, started_at: startedAt, ended_at: endedAt },
  };
}

/** A real YYYY-MM-DD calendar date, or null. Unlike biomarker dates, a start
 * date may be today or slightly in the future (planned change), so no past-only
 * bound — just calendar validity. */
function optionalDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return value;
}
