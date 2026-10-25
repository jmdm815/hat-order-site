import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { duplicateQuote } from "@/lib/quotes-store";

// Creates an independent copy of a quote/invoice as a brand-new record —
// see duplicateQuote's comment in lib/quotes-store.ts. Body: { kind: "quote"
// | "invoice" }, which record the copy is created as (the admin picks this
// from the "Create a copy" menu in the UI). Not idempotent like convert —
// every call makes a new record, since "copy" is meant to be repeatable
// (e.g. a repeat order copied again next month).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const kind = body?.kind === "invoice" ? "invoice" : "quote";

  const { record, persisted } = await duplicateQuote(id, kind);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, record, persisted });
}
