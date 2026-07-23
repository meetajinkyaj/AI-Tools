import type { Metadata } from "next";

import { AdminView } from "@/app/admin-view";

export const metadata: Metadata = {
  title: "Admin · Ikigaro",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminView />;
}
