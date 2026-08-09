import type { ReactNode } from "react";

/**
 * Shared UI primitives, styled to the Ikigaro brand system (see globals.css
 * for the design tokens). Screens compose these so every surface stays
 * consistent as new tabs are added.
 */

/** Full-height centered container, used by pre-app screens (landing, auth, onboarding). */
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
      <p className="text-body-sm text-muted">{children}</p>
    </Screen>
  );
}

/**
 * Branded startup screen. Every pre-app wait (Privy init, account sync) shows
 * this same screen so startup reads as one continuous moment instead of a
 * sequence of unrelated loading messages. The wordmark sits at a fixed
 * position; only the small caption below it changes between phases.
 */
export function Splash({ caption }: { caption?: string }) {
  return (
    <Screen>
      <div className="flex flex-col items-center gap-5">
        <Wordmark className="animate-pulse text-5xl text-ink" />
        <p className="font-label text-[0.7rem] uppercase tracking-[0.34em] text-muted">
          Performance · Recovery · Longevity
        </p>
        <p className="min-h-5 text-body-sm text-muted">{caption ?? ""}</p>
      </div>
    </Screen>
  );
}

/**
 * The Ikigaro wordmark: lowercase "ikigaro" in Cormorant Garamond with the
 * tittle of the "i" rendered in terracotta, the brand's single mandatory
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

/** Marcellus eyebrow, letterspaced caps, used above titles and as section labels. */
export function Eyebrow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`iki-eyebrow ${className}`}
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
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h1 className="iki-title">
        {title}
      </h1>
      {subtitle && <p className="iki-lede">{subtitle}</p>}
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
      className={`rounded-card border border-line bg-surface ${className}`}
    >
      {children}
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Shared class strings, kept so form fields stay consistent app-wide */
/* ------------------------------------------------------------------ */

/** Primary action: terracotta fill, cream text (radius 8). */
export const primaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-ctl bg-primary px-6 text-body-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50";

/** Secondary action: outline on the current ground. */
export const secondaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-ctl border border-line-strong bg-transparent px-5 text-body-sm font-semibold text-ink transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50";

/** Form input / select / textarea base (radius 8, terracotta focus). */
export const fieldClass =
  "h-11 w-full rounded-ctl border border-line bg-surface px-3 text-body-sm text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/20";

/** Form field label wrapper. */
export const labelClass =
  "flex flex-col gap-1.5 text-body-sm font-semibold text-ink/80";
