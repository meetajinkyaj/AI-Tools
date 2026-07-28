"use client";

import { useEffect } from "react";

import type { RankCardInput } from "@/lib/rank-share-card";
import { RankShareCard } from "./rank-share-card";

/**
 * The rank share sheet as a modal.
 *
 * Same shell as the check-in modal — dismissible three ways, page behind
 * locked — because two share sheets that behave differently is worse than
 * either behaviour on its own.
 */
export function RankShareModal({
  input,
  onClose,
}: {
  input: RankCardInput;
  onClose: () => void;
}) {
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
      // Only a press that both starts and ends on the backdrop closes it, so a
      // drag that begins inside the sheet cannot dismiss it on release.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Share your rank"
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-card bg-surface p-5 shadow-lg sm:rounded-card">
        <RankShareCard input={input} onClose={onClose} />
      </div>
    </div>
  );
}
