import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getAdminTabOverrides, setAdminTabOverride, clearAdminTabOverride } from "@/lib/admin-tabs-store";
import { isPersistent } from "@/lib/pricing-store";

// GET -> { overrides, persistent }, overrides keyed by tab id.
export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const overrides = await getAdminTabOverrides();
  return NextResponse.json({ overrides, persistent: isPersistent() });
}

// PUT { id, label, icon } -> set/replace one tab's override.
// PUT { id, reset: true } -> clear a tab's override back to its code default.
export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  const id: unknown = body?.id;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "Expected { id: string, ... }" }, { status: 400 });
  }

  if (body?.reset === true) {
    const { persisted } = await clearAdminTabOverride(id);
    return NextResponse.json({ ok: true, persisted });
  }

  const label: unknown = body?.label;
  const icon: unknown = body?.icon;
  if (typeof label !== "string" || !label.trim() || typeof icon !== "string" || !icon.trim()) {
    return NextResponse.json({ error: "Expected { id, label, icon }" }, { status: 400 });
  }
  const { persisted } = await setAdminTabOverride(id, { label: label.trim(), icon: icon.trim() });
  return NextResponse.json({ ok: true, persisted });
}
