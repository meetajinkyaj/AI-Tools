import type { ReactNode } from "react";

/**
 * Shared UI primitives, styled to the Ikigaro brand system (see globals.css
 * for the design tokens). Screens compose these so every surface stays
 * consistent as new tabs are added.
 */

/** Full-height centered container — used by pre-app screens (landing, auth, onboarding). */
export function Screen({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-1 items-center justify-center bg-background px-6 py-12 ${className}`}
    >
      {children}
    </div>
  );
}

/** A simple centered status/message screen. */
export function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <Screen>
      <p className="font-body text-sm text-muted">{children}</p>
    </Screen>
  );
}

/**
 * The Ikigaro wordmark: lowercase "ikigaro" in Cormorant Garamond with the
 * tittle of the "i" rendered in terracotta — the brand's single mandatory
 * accent. Size it by setting a font-size on `className` (e.g. `text-2xl`).
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-display font-medium lowercase leading-none tracking-tight ${className}`}
    >
      <span className="relative inline-block">
        {/* dotless i, so we can place the terracotta tittle precisely */}
        {"ı"}
        <span
          aria-hidden
          className="absolute left-1/2 rounded-full bg-terracotta"
          style={{
            width: "0.13em",
            height: "0.13em",
            top: "0.06em",
            transform: "translateX(-50%)",
          }}
        />
      </span>
      kigaro
    </span>
  );
}

/** Marcellus eyebrow — letterspaced caps, used above titles and as section labels. */
export function Eyebrow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`font-label text-[0.7rem] uppercase tracking-[0.28em] text-accent ${className}`}
    >
      {children}
    </p>
  );
}

/** Standard page header: optional eyebrow, a Cormorant title, and optional subtitle. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h1 className="font-display text-3xl font-medium leading-tight tracking-tight text-foreground sm:text-4xl">
        {title}
      </h1>
      {subtitle && <p className="font-body text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

/** Rounded surface card (radius 14) with a subtle warm border. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-card border border-border bg-surface ${className}`}
    >
      {children}
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Shared class strings — kept so form fields stay consistent app-wide */
/* ------------------------------------------------------------------ */

/** Primary action: terracotta fill, cream text (radius 8). */
export const primaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-control bg-accent px-6 font-body text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50";

/** Secondary action: outline on the current ground. */
export const secondaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-control border border-border-strong bg-transparent px-5 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50";

/** Form input / select / textarea base (radius 8, terracotta focus). */
export const fieldClass =
  "h-11 w-full rounded-control border border-border bg-surface px-3 font-body text-sm text-foreground outline-none transition-colors placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20";

/** Form field label wrapper. */
export const labelClass =
  "flex flex-col gap-1.5 font-body text-sm font-medium text-foreground/80";
