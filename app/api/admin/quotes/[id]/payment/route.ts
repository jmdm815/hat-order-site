import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { InvoicePaymentStatus, setInvoicePaymentStatus } from "@/lib/quotes-store";

const VALID: InvoicePaymentStatus[] = ["unpaid", "partially_paid", "paid"];

// Updates an invoice's payment status (unpaid / partially_paid / paid).
// Only applies to records already converted to an invoice — a plain quote
// has no payment status to set.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = body?.invoiceStatus;
  if (typeof status !== "string" || !VALID.includes(status as InvoicePaymentStatus)) {
    return NextResponse.json(
      { error: `Expected { invoiceStatus: "unpaid" | "partially_paid" | "paid" }` },
      { status: 400 }
    );
  }
  const { record, persisted } = await setInvoicePaymentStatus(id, status as InvoicePaymentStatus);
  if (!record) {
    return NextResponse.json(
      { error: "Quote not found, or it hasn't been converted to an invoice yet" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, record, persisted });
}
