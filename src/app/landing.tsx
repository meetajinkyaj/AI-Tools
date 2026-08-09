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
        {/* Both buttons open the same Privy email-OTP flow (it creates the
            account when the email is new), but new and returning users each
            get an entry that reads as theirs. */}
        <div className="flex w-full max-w-xs flex-col items-stretch gap-3">
          <button onClick={login} className={primaryButtonClass}>
            Sign up
          </button>
          <button
            onClick={login}
            className="inline-flex h-11 items-center justify-center rounded-ctl border border-linen/30 bg-transparent px-6 text-body-sm font-medium text-linen transition-colors hover:border-linen/60 hover:bg-linen/5"
          >
            Log in
          </button>
          <p className="text-micro text-tan">
            Just your email, no password needed.
          </p>
        </div>

        <nav className="mt-4 flex gap-5 text-micro uppercase tracking-[0.18em] text-tan">
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
