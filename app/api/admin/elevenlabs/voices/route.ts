import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { el, elErrorResponse } from "@/lib/elevenlabs";

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const j = await (await el("/v2/voices?page_size=100&sort=name&sort_direction=asc&include_total_count=false")).json();
    const voices = (j.voices ?? []).map((v: { voice_id: string; name: string; category?: string; preview_url?: string; labels?: Record<string, string> }) => ({
      id: v.voice_id, name: v.name, category: v.category, previewUrl: v.preview_url, labels: v.labels ?? {},
    }));
    return NextResponse.json({ voices });
  } catch (err) {
    return elErrorResponse(err);
  }
}
