import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote, recordInvoicePayment, resetInvoicePayments, InvoicePaymentEntry } from "@/lib/quotes-store";

const VALID_TENDERS: InvoicePaymentEntry["tender"][] = ["cash", "check", "other"];

// Admin-only: manually record a payment against an invoice (e.g. "customer
// paid $40 in cash") — the counterpart to the real Square card charges that
// flow in automatically through app/api/pay/[id]/route.ts. Both paths share
// lib/quotes-store.ts's recordInvoicePayment(), so amountPaid/invoiceStatus
// stay in sync regardless of how the money came in. Used by
// components/AdminInvoicePaymentModal.tsx.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  if (record.status !== "invoice") {
    return NextResponse.json({ error: "Convert this quote to an invoice first" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter a payment amount greater than $0" }, { status: 400 });
  }
  const tender = typeof body?.tender === "string" && VALID_TENDERS.includes(body.tender as never)
    ? (body.tender as InvoicePaymentEntry["tender"])
    : undefined;
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : undefined;

  const grandTotal = record.computed.grandTotal;
  const alreadyPaid = record.amountPaid ?? 0;
  const balance = Math.round((grandTotal - alreadyPaid) * 100) / 100;
  if (amount > balance + 0.02) {
    return NextResponse.json(
      { error: `That's more than the remaining balance of $${balance.toFixed(2)}.` },
      { status: 400 }
    );
  }

  const { record: updated, persisted } = await recordInvoicePayment(id, {
    amount,
    method: "manual",
    tender,
    note,
  });
  if (!updated) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, record: updated, persisted });
}

// Clears all recorded payments on this invoice back to unpaid — "Reset to
// unpaid" in the payment modal, for undoing a mistaken manual entry.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { record, persisted } = await resetInvoicePayments(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, record, persisted });
}
