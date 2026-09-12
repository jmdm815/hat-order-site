import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getGarmentMarkupSettings, setGarmentMarkupSettings } from "@/lib/garment-markup-store";
import { isPersistent } from "@/lib/pricing-store";
import { GarmentMarkupBreakpoint, GarmentMarkupLookupMode, GarmentMarkupSettings } from "@/lib/types";

function isValidBreakpoint(value: unknown): value is Omit<GarmentMarkupBreakpoint, "id"> & { id?: string } {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  if (typeof b.from !== "number" || b.from < 0) return false;
  if (typeof b.to !== "number" || b.to < b.from) return false;
  if (typeof b.markupPercent !== "number" || b.markupPercent < 0) return false;
  if (b.id !== undefined && typeof b.id !== "string") return false;
  return true;
}

function isValidSettings(value: unknown): value is GarmentMarkupSettings {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.breakpoints) || !v.breakpoints.every(isValidBreakpoint)) return false;
  const validModes: GarmentMarkupLookupMode[] = ["total-quantity", "per-style-quantity"];
  if (!validModes.includes(v.lookupMode as GarmentMarkupLookupMode)) return false;
  return true;
}

// Admin-only: the cost-based garment markup matrix used by the quote
// builder (see lib/garment-markup-store.ts, lib/garment-markup.ts). GET
// returns the current breakpoints + lookup mode; PUT replaces the whole
// settings object (the admin UI edits the table freely and saves it in one
// shot, rather than one request per row).
export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const settings = await getGarmentMarkupSettings();
  return NextResponse.json({ settings, persistent: isPersistent() });
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!isValidSettings(body)) {
    return NextResponse.json({ error: "Invalid garment markup settings" }, { status: 400 });
  }
  const { persisted } = await setGarmentMarkupSettings(body);
  const settings = await getGarmentMarkupSettings();
  return NextResponse.json({ ok: true, settings, persisted });
}
