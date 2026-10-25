import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { convertInvoiceToQuote } from "@/lib/quotes-store";

// The reverse of /api/admin/quotes/[id]/convert (quote -> invoice): creates
// (or reuses, if one already exists) a linked quote from an invoice —
// see lib/quotes-store.ts's convertInvoiceToQuote for the full rationale.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { record, persisted } = await convertInvoiceToQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, record, persisted });
}
