import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { completeConnection } from "@/lib/google-tasks";

export const runtime = "nodejs";

// Google redirects the admin's own browser back here after they approve (or
// decline) the consent screen started by .../google-tasks/auth. Exchanges
// the one-time code for tokens and stores them (lib/google-tasks-store.ts),
// then sends the browser back to the Tasks tab with a ?connected=1 or
// ?error= flag for the UI to show a result.
export async function GET(req: NextRequest) {
  const backTo = new URL("/admin?tab=tasks", req.nextUrl.origin);

  if (!(await isAdminAuthed())) {
    backTo.searchParams.set("error", "Not signed in to the admin");
    return NextResponse.redirect(backTo);
  }

  const error = req.nextUrl.searchParams.get("error");
  if (error) {
    backTo.searchParams.set("error", error);
    return NextResponse.redirect(backTo);
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("jm-google-tasks-state")?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    backTo.searchParams.set("error", "Invalid or expired connection attempt — try again.");
    return NextResponse.redirect(backTo);
  }

  try {
    await completeConnection(code, req.nextUrl.origin);
    backTo.searchParams.set("connected", "1");
  } catch (err) {
    console.error("GET /api/admin/google-tasks/callback failed", err);
    backTo.searchParams.set("error", err instanceof Error ? err.message : "Failed to connect");
  }

  const res = NextResponse.redirect(backTo);
  res.cookies.delete("jm-google-tasks-state");
  return res;
}
