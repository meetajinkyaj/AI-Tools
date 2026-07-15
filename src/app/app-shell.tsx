"use client";

import Link from "next/link";

import { Wordmark } from "./ui";

/**
 * The authenticated app shell: a shared header (wordmark + log out) and a
 * persistent tab bar, with the active section rendered as children. Every
 * signed-in screen lives inside this so navigation and chrome stay consistent
 * as the seven core sections come online.
 */

export type NavKey =
  | "home"
  | "checkin"
  | "report"
  | "trends"
  | "future"
  | "partners"
  | "profile";

export const NAV_ITEMS: { key: NavKey; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "checkin", label: "Check-in" },
  { key: "report", label: "Report" },
  { key: "trends", label: "Trends" },
  { key: "future", label: "Future You" },
  { key: "partners", label: "Partners" },
  { key: "profile", label: "Profile" },
];

export function AppShell({
  active,
  onNavigate,
  onLogout,
  children,
}: {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  onLogout?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-[1080px] items-center justify-between px-6 pt-5 pb-3">
          <button
            onClick={() => onNavigate("home")}
            className="text-2xl text-foreground"
            aria-label="Ikigaro home"
          >
            <Wordmark />
          </button>
          {onLogout && (
            <button
              onClick={onLogout}
              className="font-body text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
            >
              Log out
            </button>
          )}
        </div>
        <nav className="mx-auto w-full max-w-[1080px] overflow-x-auto px-6">
          <ul className="flex gap-7">
            {NAV_ITEMS.map((item) => {
              const isActive = item.key === active;
              return (
                <li key={item.key}>
                  <button
                    onClick={() => onNavigate(item.key)}
                    aria-current={isActive ? "page" : undefined}
                    className={`relative whitespace-nowrap py-3 font-body text-sm transition-colors ${
                      isActive
                        ? "text-foreground"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {item.label}
                    {isActive && (
                      <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-6 py-10">
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center gap-x-5 gap-y-2 px-6 py-5 font-body text-xs text-muted">
          <span>© {new Date().getFullYear()} Ikigaro</span>
          <Link href="/privacy" className="transition-colors hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-foreground">
            Terms
          </Link>
        </div>
      </footer>
    </div>
  );
}
