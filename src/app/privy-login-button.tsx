"use client";

import { usePrivy } from "@privy-io/react-auth";

export function PrivyLoginButton() {
  const { ready, authenticated, user, login, logout } = usePrivy();

  if (!ready) {
    return <p className="text-sm text-zinc-500">Loading Privy...</p>;
  }

  if (authenticated) {
    return (
      <div className="flex flex-col items-center gap-2 sm:items-start">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Signed in as {user?.email?.address ?? user?.id}
        </p>
        <button
          onClick={logout}
          className="flex h-12 items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={login}
      className="flex h-12 items-center justify-center rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
    >
      Sign in with Privy
    </button>
  );
}
