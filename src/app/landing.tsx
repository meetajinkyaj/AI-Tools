"use client";

import { usePrivy } from "@privy-io/react-auth";

import { primaryButtonClass, Screen } from "./ui";

export function Landing() {
  const { login } = usePrivy();

  return (
    <Screen>
      <main className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-4xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Ikigaro
          </h1>
          <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Your health, tracked with intention.
          </p>
        </div>
        <button onClick={login} className={primaryButtonClass}>
          Sign in with Privy
        </button>
      </main>
    </Screen>
  );
}
