import Link from "next/link";
import type { ReactNode } from "react";

import { Eyebrow, Wordmark } from "./ui";

/** Effective date shown on the legal pages. Update when the policies change. */
export const LEGAL_EFFECTIVE_DATE = "13 July 2026";

/**
 * Shared chrome + typographic styling for the public legal pages (/privacy,
 * /terms). Server component — these routes render statically, without the
 * app's auth providers. Content is authored as plain semantic HTML; the
 * wrapper styles descendants so the pages stay easy to edit.
 */
export function LegalShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-[760px] items-center justify-between px-6 py-5">
          <Link href="/" className="text-2xl text-foreground" aria-label="Ikigaro home">
            <Wordmark />
          </Link>
          <nav className="flex gap-5 font-body text-xs uppercase tracking-[0.18em] text-muted">
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[760px] flex-1 px-6 py-12">
        <div className="flex flex-col gap-2">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          <p className="font-body text-sm text-muted">
            Effective {LEGAL_EFFECTIVE_DATE}
          </p>
        </div>

        <article
          className="mt-10 flex flex-col gap-5 font-body text-sm leading-relaxed text-foreground/80 [&_a]:text-accent [&_a]:underline [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:text-foreground [&_h3]:mt-3 [&_h3]:font-body [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:mt-1.5 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5"
        >
          {children}
        </article>

        <footer className="mt-14 border-t border-border pt-6 font-body text-xs text-muted">
          <p>
            This page is provided for general information and is not legal or
            medical advice. Ikigaro is a wellness product and does not provide
            medical diagnosis or treatment.
          </p>
        </footer>
      </main>
    </div>
  );
}
