"use client";

import { usePrivy } from "@privy-io/react-auth";

import { PRIMARY_GOAL_LABELS, type ProfileRow } from "@/lib/profile";
import { secondaryButtonClass, Screen } from "./ui";

export function Dashboard({ profile }: { profile: ProfileRow }) {
  const { logout } = usePrivy();
  const firstName = profile.full_name.split(" ")[0] || profile.full_name;

  return (
    <Screen>
      <main className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Welcome, {firstName}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Your goal:{" "}
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {PRIMARY_GOAL_LABELS[profile.primary_goal]}
            </span>
          </p>
        </div>

        <div className="w-full rounded-xl border border-black/[.08] bg-white p-6 text-sm text-zinc-600 dark:border-white/[.1] dark:bg-zinc-950 dark:text-zinc-400">
          Health tracking is coming soon. Your profile is set up and ready.
        </div>

        <button onClick={logout} className={secondaryButtonClass}>
          Log out
        </button>
      </main>
    </Screen>
  );
}
