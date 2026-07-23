import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";

/** GET /api/admin/me — the admin UI calls this to decide whether to render. */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  return NextResponse.json({ email: admin.email });
}
