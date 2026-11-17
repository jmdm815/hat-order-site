import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getPitbullPrices, setPitbullPrices } from "@/lib/pitbull";

export const runtime = "nodejs";

// GET  → { byStyle: { PB311: { price, updatedAt, note } } }
// PUT  { prices: { PB311: 7.5, PB117: null /* remove */ }, note? }
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getPitbullPrices());
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { prices?: Record<string, unknown>; note?: string } | null;
  const updates: Record<string, { price: number | null; note?: string }> = {};
  for (const [k, v] of Object.entries(body?.prices ?? {})) {
    if (v === null) updates[k] = { price: null };
    else if (typeof v === "number" && v > 0 && v < 1000) updates[k] = { price: v, note: body?.note };
    else return NextResponse.json({ error: `Bad price for ${k}` }, { status: 400 });
  }
  if (!Object.keys(updates).length) return NextResponse.json({ error: "prices required" }, { status: 400 });
  const r = await setPitbullPrices(updates);
  return NextResponse.json(r);
}
