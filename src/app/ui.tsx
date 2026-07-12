import type { ReactNode } from "react";

/** Full-height centered container used by every top-level view. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-12 font-sans dark:bg-black">
      {children}
    </div>
  );
}

/** A simple centered status/message screen. */
export function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <Screen>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{children}</p>
    </Screen>
  );
}

/** Shared primary/secondary button class strings (kept consistent app-wide). */
export const primaryButtonClass =
  "flex h-12 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]";

export const secondaryButtonClass =
  "flex h-11 items-center justify-center rounded-full border border-solid border-black/[.1] px-5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-[#1a1a1a]";
