"use client";

import { useEffect, useRef } from "react";

import { CheckIcon } from "./activity-icon";
import { Wordmark } from "./ui";

/**
 * The authenticated app shell.
 *
 * SEVEN TABS BECAME FIVE PLUS A SHEET. The old bar listed every section in one
 * horizontally scrolling row, which on a phone meant three of them lived off
 * the right edge and the whole thing sat at the top, furthest from the thumb.
 *
 * The bar now holds the four sections people open daily plus the action they
 * came to perform, and the three they open occasionally live in a sheet behind
 * "More". Which three is not arbitrary: Report, Rewards and Profile are the
 * ones you visit when something has changed, not the ones you check.
 *
 * THE CHECK-IN BUTTON IS NOT A TAB. It is the one thing this app asks a member
 * to do every day, so it is a button in the middle of the bar, sitting proud of
 * it, rather than a fifth label competing with four others.
 */

export type NavKey =
  | "home"
  | "checkin"
  | "report"
  | "trends"
  | "future"
  | "partners"
  | "profile";

/** Every section, with the URL slug that deep-links to it. */
export const NAV_ITEMS: { key: NavKey; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "checkin", label: "Check-in" },
  { key: "report", label: "Report" },
  { key: "trends", label: "Trends" },
  { key: "future", label: "Future You" },
  { key: "partners", label: "Rewards" },
  { key: "profile", label: "Profile" },
];

/** The four that get a slot in the bar, in the order they appear. */
const BAR: { key: NavKey; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "trends", label: "Trends" },
  { key: "future", label: "Future" },
];

/** The three behind "More", in the order the sheet lists them. */
const SHEET: { key: NavKey; label: string }[] = [
  { key: "report", label: "Report" },
  { key: "partners", label: "Rewards" },
  { key: "profile", label: "Profile" },
];

const SHEET_KEYS = new Set<NavKey>(SHEET.map((s) => s.key));

/* --------------------------------- icons ---------------------------------- */

/*
 * The nav's own glyphs, at the handoff's 1.8 stroke rather than the 1.7 the
 * activity set uses: a 22px icon on a translucent bar needs the extra weight to
 * hold its shape. Inlined for the same reason as `activity-icon.tsx`, which is
 * that four paths do not justify an icon dependency in a Worker bundle.
 */
const NAV_PATHS: Record<string, string[]> = {
  home: ["M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8", "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  trends: ["M3 3v16a2 2 0 0 0 2 2h16", "m19 9-5 5-4-4-3 3"],
  future: ["M12 2v2", "m4.93 4.93 1.41 1.41", "M2 12h2", "M20 12h2", "m19.07 4.93-1.41 1.41", "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z", "M12 20v2"],
  more: ["M12 12h.01", "M19 12h.01", "M5 12h.01"],
};

function NavIcon({ name }: { name: keyof typeof NAV_PATHS }) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {NAV_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Two letters from a name, for the header chip. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* --------------------------------- sheet ---------------------------------- */

/**
 * The More sheet.
 *
 * A REAL DIALOG, because it takes over the screen. Escape closes it, a tap on
 * the backdrop closes it, choosing a row closes it, and focus moves into the
 * panel on open and back to the More button on close. A sheet you can tab
 * behind is a trap for anybody not using a pointer, and it is the commonest
 * thing a hand-rolled overlay gets wrong.
 */
function MoreSheet({
  active,
  onNavigate,
  onClose,
}: {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the panel itself rather than its first row: landing on "Report"
    // announces one option out of three, where the panel announces the group.
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // The trap. Without it, Tab walks out of the sheet and into the page
      // underneath, which is still there and still scrollable.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>("button");
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
        aria-label="More"
        tabIndex={-1}
        className="iki-sheet"
      >
        <span className="iki-sheet-handle" aria-hidden />
        <div className="flex flex-col">
          {SHEET.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                onNavigate(item.key);
                onClose();
              }}
              aria-current={item.key === active ? "page" : undefined}
              className="iki-row-sheet iki-press border-b border-line px-2 last:border-b-0"
            >
              <span className={item.key === active ? "text-primary" : undefined}>
                {item.label}
              </span>
              <span className="text-muted" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="iki-btn iki-btn-ceremonial w-full border-0"
        >
          Close
        </button>
      </div>
    </>
  );
}

/* --------------------------------- shell ---------------------------------- */

export function AppShell({
  active,
  onNavigate,
  sheetOpen,
  onSheetOpen,
  onSheetClose,
  displayName,
  children,
}: {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  sheetOpen: boolean;
  onSheetOpen: () => void;
  onSheetClose: () => void;
  /** For the header chip. Empty is fine; the chip just goes without letters. */
  displayName?: string;
  children: React.ReactNode;
}) {
  const moreRef = useRef<HTMLButtonElement>(null);

  const closeSheet = () => {
    onSheetClose();
    // Focus returns to the control that opened the sheet, not to the top of
    // the document, which is where a keyboard user would otherwise land.
    moreRef.current?.focus();
  };

  // "More" reads as current both while its sheet is open and while you are on
  // one of the screens it leads to, because otherwise three of the seven
  // sections have no representation in the bar at all.
  const moreActive = sheetOpen || SHEET_KEYS.has(active);

  return (
    <div className="relative flex min-h-full flex-1 flex-col bg-canvas">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-gutter pt-safe-t">
        <header className="flex items-center justify-between gap-4 py-5">
          <button
            type="button"
            onClick={() => onNavigate("home")}
            className="iki-tap iki-press text-2xl text-ink"
            aria-label="Ikigaro home"
          >
            <Wordmark />
          </button>
          <button
            type="button"
            onClick={() => onNavigate("profile")}
            className="iki-tap iki-avatar"
            aria-label="Your profile"
          >
            {initialsOf(displayName ?? "")}
          </button>
        </header>

        {/* The bottom padding clears the floating bar and the home indicator.
            Without it the last card on every screen sits under the nav. */}
        <main className="flex-1 pb-shell-bottom">{children}</main>
      </div>

      <nav className="iki-nav mx-auto max-w-xl" aria-label="Sections">
        {BAR.slice(0, 2).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onNavigate(item.key)}
            aria-current={item.key === active ? "page" : undefined}
            className="iki-nav-item"
          >
            <NavIcon name={item.key} />
            {item.label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => onNavigate("checkin")}
          aria-label="Daily check-in"
          aria-current={active === "checkin" ? "page" : undefined}
          className="iki-nav-fab"
        >
          {/* A tick rather than a plus: you are completing today, not adding
              a record. */}
          <CheckIcon size={24} />
        </button>

        {BAR.slice(2).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onNavigate(item.key)}
            aria-current={item.key === active ? "page" : undefined}
            className="iki-nav-item"
          >
            <NavIcon name={item.key} />
            {item.label}
          </button>
        ))}

        <button
          ref={moreRef}
          type="button"
          onClick={() => (sheetOpen ? closeSheet() : onSheetOpen())}
          aria-expanded={sheetOpen}
          aria-haspopup="dialog"
          aria-current={moreActive ? "page" : undefined}
          className="iki-nav-item"
        >
          <NavIcon name="more" />
          More
        </button>
      </nav>

      {sheetOpen && (
        <MoreSheet active={active} onNavigate={onNavigate} onClose={closeSheet} />
      )}
    </div>
  );
}
