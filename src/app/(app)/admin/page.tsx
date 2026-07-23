import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminView } from "@/app/admin-view";

export const metadata: Metadata = {
  title: "Admin · Ikigaro",
  robots: { index: false, follow: false },
};

// The admin console has a single front door: the gated admin.ikigaro.com
// subdomain (behind Cloudflare Access). If someone reaches /admin on the main
// app domain, send them there. Localhost/preview hosts fall through so /admin
// still works in development. (Done here in the page rather than in middleware
// because the Workers runtime doesn't run Node-runtime proxy/middleware.)
const MAIN_HOST = "app.ikigaro.com";
const ADMIN_URL = "https://admin.ikigaro.com/admin";

export default async function AdminPage() {
  const host = (await headers()).get("host");
  if (host === MAIN_HOST) {
    redirect(ADMIN_URL);
  }
  return <AdminView />;
}
