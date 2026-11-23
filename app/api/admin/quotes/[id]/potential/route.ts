import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { setQuotePotential } from "@/lib/quotes-store";

export const runtime = "nodejs";

// POST { potential: boolean } — false = "Make it a quote" (moves it to the
// Quotes list and gives it a QT number); true = move a quote back to
// Potential Quotes.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.potential !== "boolean") {
    return NextResponse.json({ error: "potential (true/false) required" }, { status: 400 });
  }
  const { record, persisted } = await setQuotePotential(id, body.potential);
  if (!record) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  return NextResponse.json({ ok: true, record, persisted });
}
