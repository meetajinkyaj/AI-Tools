import { ClientLayout } from "../client-layout";

/**
 * Layout for the interactive app routes. The Privy/Supabase providers live
 * here (client-only) rather than in the root layout, so public routes like
 * /privacy and /terms render statically without pulling in auth.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <ClientLayout>{children}</ClientLayout>;
}
