"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A bottom sheet that is a real dialog.
 *
 * Lifted from the old More sheet when v2 removed it, because the rank ladder
 * (v2 section 4.2) takes over the screen in the same way and needs the same
 * guarantees. Escape closes it, a tap on the backdrop closes it, focus moves
 * into the panel on open and Tab cannot walk out of it. Returning focus to
 * whatever opened it is the caller's job, since only the caller holds a ref to
 * that control.
 *
 * A sheet you can tab behind is a trap for anybody not using a pointer, and it
 * is the commonest thing a hand-rolled overlay gets wrong.
 */
export function Sheet({
  label,
  onClose,
  children,
  className = "",
}: {
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the panel itself rather than its first control: landing on a
    // button announces one option, where the panel announces the whole sheet.
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // The trap. Without it, Tab walks out of the sheet and into the page
      // underneath, which is still there and still scrollable.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="iki-sheet-backdrop" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`iki-sheet ${className}`}
      >
        <span className="iki-sheet-handle" aria-hidden />
        {children}
      </div>
    </>
  );
}
