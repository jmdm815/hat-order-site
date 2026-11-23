import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { el, elErrorResponse } from "@/lib/elevenlabs";

// Poll a video generation. When completed, returns a signed content URL
// (expires ~1 hour; poll again for a fresh one).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = (await params).id;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  try {
    const j = await (await el(`/v1/flows/video/${id}`)).json();
    return NextResponse.json({ id: j.id, status: j.status, url: j.content_url ?? null, failure: j.failure_reason ?? null, message: j.error_message ?? null });
  } catch (err) {
    return elErrorResponse(err);
  }
}
