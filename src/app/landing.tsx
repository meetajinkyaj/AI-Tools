"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

import { primaryButtonClass, Wordmark } from "./ui";

export function Landing() {
  const { login } = usePrivy();

  return (
    // The signed-out hero uses the charcoal ground (the brand's second core
    // ground) for a premium, editorial first impression.
    <div className="flex flex-1 items-center justify-center bg-obsidian px-6 py-12">
      <main className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-5">
          <Wordmark className="text-5xl text-linen" />
          <p className="font-label text-[0.7rem] uppercase tracking-[0.34em] text-tan">
            Performance · Recovery · Longevity
          </p>
        </div>
        <p className="font-display text-2xl font-medium leading-snug text-linen/90">
          The operating system for performance, recovery &amp; longevity.
        </p>
        <button onClick={login} className={primaryButtonClass}>
          Sign in
        </button>

        <nav className="mt-4 flex gap-5 font-body text-xs uppercase tracking-[0.18em] text-tan">
          <Link href="/privacy" className="transition-colors hover:text-linen">
            Privacy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-linen">
            Terms
          </Link>
        </nav>
      </main>
    </div>
  );
}
