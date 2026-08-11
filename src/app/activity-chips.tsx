import { EXERCISE_TYPE_LABELS, EXERCISE_TYPES } from "@/lib/exercises";

/**
 * Multi-select chip group for choosing activity types. Controlled, used by the
 * onboarding and profile-edit forms to set the user's usual activities.
 */
export function ActivityChips({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(type: string) {
    onChange(
      value.includes(type)
        ? value.filter((t) => t !== type)
        : [...value, type],
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {EXERCISE_TYPES.map((type) => {
        const selected = value.includes(type);
        return (
          <button
            key={type}
            type="button"
            onClick={() => toggle(type)}
            aria-pressed={selected}
            className={`iki-tap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              selected
                ? "border-primary bg-primary text-primary-fg"
                : "border-line bg-surface text-ink hover:border-primary/50"
            }`}
          >
            {EXERCISE_TYPE_LABELS[type]}
          </button>
        );
      })}
    </div>
  );
}
