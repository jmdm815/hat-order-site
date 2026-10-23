import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getGoogleTasksConnection, clearGoogleTasksConnection } from "@/lib/google-tasks-store";
import { isGoogleTasksConfigured, listTaskLists, GoogleTasksNotConnectedError } from "@/lib/google-tasks";

export const runtime = "nodejs";

// Admin-only: connection status for the Tasks tab — whether Google Tasks
// OAuth is even configured on this deployment, whether an account is
// currently connected (and which one), and that account's task lists (most
// people only have one, "My Tasks", but Google Tasks supports several).
export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const configured = isGoogleTasksConfigured();
  if (!configured) {
    return NextResponse.json({ configured: false, connected: false, lists: [] });
  }

  const conn = await getGoogleTasksConnection();
  if (!conn) {
    return NextResponse.json({ configured: true, connected: false, lists: [] });
  }

  try {
    const lists = await listTaskLists();
    return NextResponse.json({ configured: true, connected: true, connectedEmail: conn.connectedEmail, lists });
  } catch (err) {
    if (err instanceof GoogleTasksNotConnectedError) {
      return NextResponse.json({ configured: true, connected: false, lists: [] });
    }
    console.error("GET /api/admin/google-tasks failed", err);
    return NextResponse.json(
      { configured: true, connected: true, connectedEmail: conn.connectedEmail, lists: [], error: "Failed to load task lists" },
      { status: 200 }
    );
  }
}

// Admin-only: "Disconnect" — forgets the stored tokens. Doesn't revoke them
// on Google's side (the admin can do that from myaccount.google.com/
// permissions if they want to fully revoke access); this just makes the
// site stop using them.
export async function DELETE() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { persisted } = await clearGoogleTasksConnection();
  return NextResponse.json({ ok: true, persisted });
}
