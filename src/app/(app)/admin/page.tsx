import type { Metadata } from "next";

import { AdminView } from "@/app/admin-view";

export const metadata: Metadata = {
  title: "Admin · Ikigaro",
  robots: { index: false, follow: false },
};

/**
 * The admin console.
 *
 * The host split — app.ikigaro.com/admin → the Cloudflare Access-gated
 * admin.ikigaro.com — is a **config redirect** (`next.config.ts`), not a
 * `redirect()` call here. Doing it in the page does not work: this page
 * streams, and in a streaming context Next emits a client-side redirect
 * instruction rather than an HTTP one, so the response is a 200 that only a
 * React-running browser acts on. The config redirect returns a real 307 before
 * rendering, and an E2E test asserts it against production.
 *
 * Authorization never depended on that redirect: `requireAdmin` (ADMIN_EMAILS,
 * fail-closed) gates every admin API server-side, so reaching this page on any
 * host yields a sign-in wall and nothing more.
 */
export default function AdminPage() {
  return <AdminView />;
}
