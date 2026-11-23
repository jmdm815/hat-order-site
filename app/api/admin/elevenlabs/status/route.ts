import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { el, elErrorResponse, hasElevenLabsKey } from "@/lib/elevenlabs";

// Connection + plan/credit status for the Ad Studio header.
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasElevenLabsKey()) return NextResponse.json({ connected: false });
  try {
    const s = await (await el("/v1/user/subscription")).json();
    return NextResponse.json({
      connected: true,
      tier: s.tier,
      used: s.character_count,
      limit: s.character_limit,
      resetsAt: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString() : null,
    });
  } catch (err) {
    return elErrorResponse(err);
  }
}
