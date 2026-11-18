import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { setQuoteArchived } from "@/lib/quotes-store";

export const runtime = "nodejs";

// POST { archived: boolean } — archive (hide from the to-do list, keep
// forever) or unarchive a quote/invoice.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.archived !== "boolean") {
    return NextResponse.json({ error: "archived (true/false) required" }, { status: 400 });
  }
  const { record, persisted } = await setQuoteArchived(id, body.archived, "manual");
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, record, persisted });
}
