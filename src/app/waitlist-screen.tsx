"use client";

import { Card, Eyebrow, primaryButtonClass, Screen, secondaryButtonClass } from "./ui";

/**
 * What a signed-in but not-yet-approved user sees. Their email is already
 * verified (Privy OTP), so the admin can approve them from the console's Users
 * tab; "Check again" re-runs the access check without a fresh login.
 */
export function WaitlistScreen({
  email,
  onRefresh,
  onLogout,
  checking,
}: {
  email: string | null;
  onRefresh: () => void;
  onLogout: () => void;
  checking: boolean;
}) {
  return (
    <Screen>
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Eyebrow>Private beta</Eyebrow>
          <h1 className="font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            You&rsquo;re on the list.
          </h1>
          <p className="font-body text-sm leading-relaxed text-muted">
            Ikigaro is in a small private beta and we&rsquo;re letting people in
            deliberately, in batches — so every tester gets our full attention.
            {email ? (
              <>
                {" "}Your spot is reserved under{" "}
                <span className="font-medium text-foreground">{email}</span>.
              </>
            ) : null}
          </p>
        </div>

        <Card className="flex flex-col gap-2 p-5">
          <p className="font-body text-sm text-foreground/80">
            Nothing else to do — when your access opens, this screen becomes the
            app. If you were invited personally, tell the person who invited you
            and they&rsquo;ll wave you through.
          </p>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={onRefresh}
            disabled={checking}
            className={`${primaryButtonClass} w-full sm:flex-1`}
          >
            {checking ? "Checking…" : "Check again"}
          </button>
          <button
            onClick={onLogout}
            disabled={checking}
            className={`${secondaryButtonClass} w-full sm:flex-1`}
          >
            Sign out
          </button>
        </div>
      </div>
    </Screen>
  );
}
