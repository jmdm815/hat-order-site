import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { isAdminAuthed } from "@/lib/admin-auth";
import { cleanPreset, getPressPresets, PressPreset, setPressPresets } from "@/lib/press-presets-store";

// Admin-only: the saved heat-press presets (see lib/press-presets-store.ts).
// GET lists them; PUT replaces the whole list (add/edit/delete/reorder all
// happen client-side in AdminJobFolderModal.tsx's "Manage presets" editor).
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ presets: await getPressPresets() });
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.presets)) {
    return NextResponse.json({ error: "Expected a presets array" }, { status: 400 });
  }
  const presets: PressPreset[] = [];
  for (const raw of body.presets.slice(0, 50)) {
    const p = cleanPreset(raw);
    if (!p) continue;
    presets.push({ ...p, id: p.id ?? uuid(), name: p.name || `${p.heat} / ${p.time}` });
  }
  const { persisted } = await setPressPresets(presets);
  return NextResponse.json({ presets, persisted });
}
