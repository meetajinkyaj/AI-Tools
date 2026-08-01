import { PUBLIC_APP_ENV } from "@/lib/app-env";

/**
 * A persistent marker on any non-production deployment, so a tester can never
 * mistake staging for the live app (or report a "bug" from the wrong one).
 *
 * Server-rendered from a build-time constant, so there is no hydration mismatch
 * and nothing to load, on production it compiles away to nothing at all.
 *
 * Deliberately `pointer-events-none`: it must never intercept a tap, and it is
 * intentionally not dismissible.
 */
export function EnvBanner() {
  if (PUBLIC_APP_ENV === "production") return null;

  const label = PUBLIC_APP_ENV === "staging" ? "Staging" : "Local";

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed bottom-3 left-3 z-50 select-none rounded-full border border-terracotta/40 bg-obsidian/90 px-3 py-1 font-label text-[0.6rem] uppercase tracking-[0.2em] text-linen shadow-lg"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      {label} · not live data
    </div>
  );
}
