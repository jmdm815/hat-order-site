import { NextRequest, NextResponse } from "next/server";
import {
  getDesignerSettings,
  isPersistent,
  setDesignerSettings,
  type DesignerSettings,
} from "@/lib/pricing-store";
import { isAdminAuthed } from "@/lib/admin-auth";

// Site-wide live-designer on/off switches (see lib/pricing-store.ts's
// DesignerSettings). Decoration type pricing used to live on this same
// route as id-keyed overrides — it's now part of full decoration-type CRUD
// at /api/admin/decoration-types, since pricing is just one editable field
// of a decoration type now, not a separate override layer.
function isValidDesignerSettings(value: unknown): value is DesignerSettings {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { hatsEnabled?: unknown; shirtsEnabled?: unknown };
  return typeof v.hatsEnabled === "boolean" && typeof v.shirtsEnabled === "boolean";
}

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const designerSettings = await getDesignerSettings();
  return NextResponse.json({ designerSettings, persistent: isPersistent() });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  const designerSettings: unknown = body?.designerSettings;

  if (!isValidDesignerSettings(designerSettings)) {
    return NextResponse.json(
      { error: "Expected { designerSettings: { hatsEnabled: boolean, shirtsEnabled: boolean } }" },
      { status: 400 }
    );
  }

  const { persisted } = await setDesignerSettings(designerSettings);
  return NextResponse.json({ ok: true, persisted });
}
