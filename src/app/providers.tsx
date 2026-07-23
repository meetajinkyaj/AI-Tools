"use client";

import { PrivyProvider } from "@privy-io/react-auth";

import { PRIVY_APP_ID } from "@/lib/privy-app-id";
import { Telemetry } from "./telemetry";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        appearance: {
          theme: "light",
        },
      }}
    >
      <Telemetry />
      {children}
    </PrivyProvider>
  );
}
