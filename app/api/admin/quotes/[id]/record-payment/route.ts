import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote, recordInvoicePayment, resetInvoicePayments, updatePaymentDetails, InvoicePaymentEntry } from "@/lib/quotes-store";

const VALID_TENDERS: InvoicePaymentEntry["tender"][] = ["cash", "check", "card", "shopvox", "zelle", "other"];

// Admin-only: manually record a payment against a quote or an invoice (e.g.
// "customer paid $40 in cash") — the counterpart to the real Square card
// charges that flow in automatically through app/api/pay/[id]/route.ts.
// Allowed on a plain quote too, so a deposit taken before converting to an
// invoice (cash/check at the counter, or paid off-platform through a Square
// link) can still be tracked here. Both paths share lib/quotes-store.ts's
// recordInvoicePayment(), so amountPaid/invoiceStatus stay in sync
// regardless of how the money came in. Used by
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

  const body = await req.json().catch(() => null);
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter a payment amount greater than $0" }, { status: 400 });
  }
  const tender = typeof body?.tender === "string" && VALID_TENDERS.includes(body.tender as never)
    ? (body.tender as InvoicePaymentEntry["tender"])
    : undefined;
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : undefined;
  const checkNumber =
    tender === "check" && typeof body?.checkNumber === "string" && body.checkNumber.trim()
      ? body.checkNumber.trim().slice(0, 40)
      : undefined;

  const transactionId =
    typeof body?.transactionId === "string" && body.transactionId.trim()
      ? body.transactionId.trim().slice(0, 60)
      : undefined;

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
    checkNumber,
    transactionId,
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

// PATCH { paymentId, transactionId?, note? } — edit one recorded payment's
// reference/note (e.g. add the Zelle transaction number). Empty string clears.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const paymentId = typeof body?.paymentId === "string" ? body.paymentId : "";
  if (!paymentId) return NextResponse.json({ error: "paymentId required" }, { status: 400 });
  const pick = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : undefined);
  const { record, payment, persisted } = await updatePaymentDetails(id, paymentId, {
    transactionId: pick(body?.transactionId, 60),
    note: pick(body?.note, 500),
  });
  if (!record) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  return NextResponse.json({ ok: true, record, payment, persisted });
}
