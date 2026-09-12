import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { convertQuoteToInvoice } from "@/lib/quotes-store";

// Converts a saved quote into an invoice: assigns a sequential invoice
// number and sets its payment status to "unpaid". A record already
// converted is left as-is (idempotent) rather than erroring or reassigning
// a new invoice number.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { record, persisted } = await convertQuoteToInvoice(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, record, persisted });
}
