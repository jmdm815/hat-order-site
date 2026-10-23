import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getJobs } from "@/lib/jobs-store";
import { isPersistent } from "@/lib/pricing-store";

export const runtime = "nodejs";

// Admin-only: every production job, newest-created last (see
// lib/jobs-store.ts) — the Jobs tab (components/AdminJobsTab.tsx) groups
// these client-side into a board by station (decorationLabel).
export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const jobs = await getJobs();
  return NextResponse.json({ jobs, persistent: isPersistent() });
}
