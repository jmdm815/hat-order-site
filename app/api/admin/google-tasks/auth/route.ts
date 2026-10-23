import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { isGoogleTasksConfigured, buildAuthUrl } from "@/lib/google-tasks";

export const runtime = "nodejs";

// Admin-only: "Connect Google account" button in the Tasks tab redirects
// the browser here, which immediately redirects on to Google's own consent
// screen. `state` is a lightweight CSRF guard — the callback route checks
// it matches the cookie set here before exchanging the code.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isGoogleTasksConfigured()) {
    return NextResponse.json(
      { error: "Google Tasks isn't configured yet (missing GOOGLE_TASKS_CLIENT_ID/SECRET)." },
      { status: 503 }
    );
  }

  const state = crypto.randomUUID();
  const url = buildAuthUrl(req.nextUrl.origin, state);
  const res = NextResponse.redirect(url);
  res.cookies.set("jm-google-tasks-state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
