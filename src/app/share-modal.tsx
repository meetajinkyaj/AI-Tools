"use client";

import { useEffect, useRef } from "react";

import type { ShareCardInput } from "@/lib/share-card";
import { ShareCheckinCard } from "./share-card";

/**
 * The share sheet as a modal, shown the instant a check-in saves.
 *
 * Inline, it sat below the fold of a long form, people finished checking in,
 * looked at the "Done ✓" confirmation, and never scrolled far enough to see
 * it existed. A modal is the honest way to offer something at the moment of
 * the win: it is the one interruption the flow can justify, and it is
 * dismissible three ways (✕, Escape, tapping the backdrop).
 *
 * Sharing is still reachable later from the inline entry point on the check-in
 * tab, so dismissing this costs nothing.
 */
export function ShareModal({
  input,
  onClose,
}: {
  input: ShareCardInput;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, and the page behind must not scroll while this is open, // otherwise flicking the sheet on a phone scrolls the check-in form instead.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      // Only a click that both starts and ends on the backdrop closes it.
      // Using onClick alone means a drag that begins inside the sheet, while
      // scrolling it, or dragging a toggle, releases on the backdrop and
      // dismisses the user's work.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Share your check-in"
    >
      <div
        ref={panelRef}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-card bg-surface p-5 shadow-lg sm:rounded-card"
      >
        <ShareCheckinCard input={input} onClose={onClose} />
      </div>
    </div>
  );
}
