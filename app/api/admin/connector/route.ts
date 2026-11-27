import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createConnectorKey, getConnectorKeyInfo, revokeConnectorKey } from "@/lib/connector-key-store";

// Admin-only management of the JM Admin connector key (see
// lib/connector-key-store.ts). GET: is a key active. POST: make a new key and
// return the connector URL with it (shown once). DELETE: turn the connector off.

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    ...(await getConnectorKeyInfo()),
    agentKeyConfigured: Boolean(process.env.AGENT_API_KEY),
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.AGENT_API_KEY) {
    return NextResponse.json(
      { error: "AGENT_API_KEY isn't set on this deployment, so the connector can't reach the admin yet." },
      { status: 503 }
    );
  }
  try {
    const key = await createConnectorKey();
    const url = `${req.nextUrl.origin}/api/mcp?key=${encodeURIComponent(key)}`;
    return NextResponse.json({ url, ...(await getConnectorKeyInfo()) });
  } catch (err) {
    console.error("POST /api/admin/connector failed", err);
    return NextResponse.json({ error: "Couldn't save the connector key." }, { status: 500 });
  }
}

export async function DELETE() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await revokeConnectorKey();
  return NextResponse.json({ active: false });
}
