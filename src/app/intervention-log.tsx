"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  INTERVENTION_TYPE_LABELS,
  INTERVENTION_TYPES,
  type InterventionType,
} from "@/lib/interventions";
import { Card, Eyebrow, fieldClass, primaryButtonClass } from "./ui";

interface InterventionRow {
  id: string;
  type: InterventionType;
  label: string;
  dose_note: string | null;
  started_at: string;
}

/**
 * A 30-second "what changed" logger. Captures interventions (supplements, diet,
 * training…) so we can later attribute biomarker movement to them. Compact by
 * design — it lives as a card on the dashboard.
 */
export function InterventionLog({
  getToken,
}: {
  getToken: () => Promise<string | null>;
}) {
  const [items, setItems] = useState<InterventionRow[]>([]);
  const [type, setType] = useState<InterventionType>("supplement");
  const [label, setLabel] = useState("");
  const [dose, setDose] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/interventions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const d = (await res.json()) as { interventions: InterventionRow[] };
      setItems(d.interventions ?? []);
    } catch (err) {
      console.error("Failed to load interventions:", err);
    }
  }, [getToken]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (label.trim() === "") {
      setError("Add what you changed.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("You're not signed in. Please reload and try again.");
        return;
      }
      const res = await fetch("/api/interventions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type, label, dose_note: dose || null }),
      });
      const result = (await res.json()) as {
        intervention?: InterventionRow;
        error?: string;
      };
      if (!res.ok || !result.intervention) {
        setError(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      setItems((prev) => [result.intervention!, ...prev]);
      setLabel("");
      setDose("");
    } catch (err) {
      console.error("Intervention save failed:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <Eyebrow>Log a change</Eyebrow>
        <p className="font-body text-sm text-muted">
          Started a supplement, changed your training or diet? Note it — we&rsquo;ll
          connect it to how your markers move.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            className={`${fieldClass} sm:w-40`}
            value={type}
            onChange={(e) => setType(e.target.value as InterventionType)}
          >
            {INTERVENTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {INTERVENTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            className={`${fieldClass} flex-1`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            placeholder="e.g. Magnesium glycinate"
          />
        </div>
        <input
          className={fieldClass}
          value={dose}
          onChange={(e) => setDose(e.target.value)}
          maxLength={200}
          placeholder="Optional note — e.g. 400mg nightly"
        />

        {error && <p className="font-body text-sm text-accent-hover">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className={`${primaryButtonClass} self-start`}
        >
          {saving ? "Saving…" : "Log it"}
        </button>
      </form>

      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {items.slice(0, 5).map((it) => (
            <li key={it.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 font-body text-sm text-foreground">
                <span className="text-muted">{INTERVENTION_TYPE_LABELS[it.type]} · </span>
                {it.label}
                {it.dose_note ? (
                  <span className="text-muted"> — {it.dose_note}</span>
                ) : null}
              </span>
              <span className="shrink-0 font-body text-xs text-muted">
                {it.started_at}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
