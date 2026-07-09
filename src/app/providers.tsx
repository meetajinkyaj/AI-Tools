"use client";

import { PrivyProvider } from "@privy-io/react-auth";

import { useSyncUser } from "./use-sync-user";

function UserSync() {
  useSyncUser();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email"],
        appearance: {
          theme: "light",
        },
      }}
    >
      <UserSync />
      {children}
    </PrivyProvider>
  );
}
