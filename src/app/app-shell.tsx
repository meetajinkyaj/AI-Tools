"use client";

import type { ReactNode } from "react";

import { CHALLENGES_ENABLED } from "@/lib/flags";
import { CheckIcon } from "./activity-icon";
import { Icon, type IconName } from "./icons";
import { Wordmark } from "./ui";

/**
 * The authenticated app shell (UI v2, section 4.0).
 *
 * THE MORE SHEET IS GONE. v1 kept Report, Rewards and Profile behind "More";
 * v2 reaches each from where it is wanted instead. Report and Rewards are tiles
 * on Home, Profile is the labelled chip in the header. The bar is now
 * Home, Trends, the check-in button, Future, and a Challenges slot that ships
 * visible but inert until the social features behind it exist.
 *
 * THE CHECK-IN BUTTON IS NOT A TAB. It is the one thing this app asks a member
 * to do every day, so it is a button in the middle of the bar, sitting proud of
 * it, rather than a label competing with the others.
 *
 * Report, Rewards and Profile are still NavKeys, so `?tab=report`,
 * `?tab=partners` and `?tab=profile` deep links keep working. On those screens
 * no bar item is current, and every slot renders inactive.
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

/** The bar's sections either side of the check-in button. */
const BAR_LEFT: { key: NavKey; label: string; icon: IconName }[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "trends", label: "Trends", icon: "chart-line" },
];
const BAR_RIGHT: { key: NavKey; label: string; icon: IconName }[] = [
  { key: "future", label: "Future", icon: "sun" },
];

/**
 * Sub-screens: reached from Home rather than the bar, so their header offers
 * the way back ("‹ Home") where the other screens show the wordmark.
 */
const SUB_SCREENS = new Set<NavKey>(["partners", "profile"]);

/** Two letters from a name, for the header chip. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* --------------------------------- pieces --------------------------------- */

/** "Profile" plus initials, replacing v1's bare avatar. */
export function ProfileChip({
  displayName,
  onOpen,
}: {
  displayName?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="iki-tap iki-press iki-profile-chip"
      aria-label="Profile"
    >
      <span>Profile</span>
      <span className="iki-profile-chip-initials" aria-hidden>
        {initialsOf(displayName ?? "")}
      </span>
    </button>
  );
}

/** "‹ Home", for Rewards and Profile. */
export function BackHome({ onNavigate }: { onNavigate: (key: NavKey) => void }) {
  return (
    <button
      type="button"
      onClick={() => onNavigate("home")}
      className="iki-tap iki-press flex items-center gap-1 text-body-sm font-semibold text-ink"
    >
      <Icon name="chevron-left" size={18} strokeWidth={2} />
      Home
    </button>
  );
}

/**
 * The Challenges slot.
 *
 * DISABLED IS A SPAN, NOT A DISABLED BUTTON. A button with `disabled` is still
 * announced as a button and, in some browsers, still reachable; this slot has
 * no action at all yet, so it is not a control. `aria-disabled` plus the
 * visually hidden ", coming soon" tells a screen reader what the dimmed trophy
 * is. The badge is decoration and hidden from assistive tech, since the
 * hidden text already says it.
 */
export function ChallengesSlot({
  enabled = CHALLENGES_ENABLED,
  onOpen,
}: {
  enabled?: boolean;
  onOpen?: () => void;
}) {
  const glyph = (
    <span className="relative inline-flex">
      <Icon name="trophy" />
      {!enabled && (
        <span className="iki-soon-badge" aria-hidden>
          Soon
        </span>
      )}
    </span>
  );

  if (enabled && onOpen) {
    return (
      <button type="button" onClick={onOpen} className="iki-nav-item">
        {glyph}
        Challenges
      </button>
    );
  }

  return (
    <span className="iki-nav-item iki-nav-item-disabled" aria-disabled="true">
      {glyph}
      <span>
        Challenges<span className="sr-only">, coming soon</span>
      </span>
    </span>
  );
}

/* --------------------------------- shell ---------------------------------- */

export function AppShell({
  active,
  onNavigate,
  displayName,
  headerRight,
  onChallenges,
  children,
}: {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  /** For the header chip. Empty is fine; the chip just goes without letters. */
  displayName?: string;
  /**
   * Replaces the Profile chip on the right of the header, for a screen that
   * owns that spot (Profile's "Edit profile", Check-in's "Cancel"). Pass
   * `null` to leave it empty.
   */
  headerRight?: ReactNode;
  /** Only used once CHALLENGES_ENABLED is true. */
  onChallenges?: () => void;
  children: ReactNode;
}) {
  const isSub = SUB_SCREENS.has(active);

  const navItem = (item: { key: NavKey; label: string; icon: IconName }) => (
    <button
      key={item.key}
      type="button"
      onClick={() => onNavigate(item.key)}
      aria-current={item.key === active ? "page" : undefined}
      className="iki-nav-item"
    >
      <Icon name={item.icon} />
      {item.label}
    </button>
  );

  return (
    <div className="relative flex min-h-full flex-1 flex-col bg-canvas">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-gutter pt-safe-t">
        <header className="flex min-h-tap items-center justify-between gap-4 py-5">
          {isSub ? (
            <BackHome onNavigate={onNavigate} />
          ) : (
            <button
              type="button"
              onClick={() => onNavigate("home")}
              className="iki-tap iki-press text-2xl text-ink"
              aria-label="Ikigaro home"
            >
              <Wordmark />
            </button>
          )}
          {headerRight !== undefined ? (
            headerRight
          ) : active === "profile" ? null : (
            <ProfileChip displayName={displayName} onOpen={() => onNavigate("profile")} />
          )}
        </header>

        {/* The bottom padding clears the floating bar and the home indicator.
            Without it the last card on every screen sits under the nav. */}
        <main className="flex-1 pb-shell-bottom">{children}</main>
      </div>

      <nav className="iki-nav mx-auto max-w-xl" aria-label="Sections">
        {BAR_LEFT.map(navItem)}

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

        {BAR_RIGHT.map(navItem)}

        <ChallengesSlot onOpen={onChallenges} />
      </nav>
    </div>
  );
}
