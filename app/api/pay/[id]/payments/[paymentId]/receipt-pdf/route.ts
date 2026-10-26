import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/quotes-store";
import { renderPaymentReceiptPdf } from "@/lib/quote-pdf";

export const runtime = "nodejs";

const TENDER_LABEL: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  other: "Other",
};

// Public, customer-facing — same unguessable-id security model as the rest
// of this page (see app/api/pay/[id]/route.ts's header comment); paymentId
// is a second random uuid on top of that. Unlike
// app/api/pay/[id]/receipt-pdf/route.ts (which always renders the record's
// current whole-order snapshot — the right document once it's paid in
// full), this renders a standalone receipt for exactly ONE payment, so a
// customer who paid a deposit and comes back later can get a record of
// that specific transaction instead of only ever being able to download
// "the current state of the whole order." Linked from each row of the
// payment-history list in InvoicePayClient.tsx / AdminInvoicePaymentModal.tsx.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const { id, paymentId } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const payments = record.payments ?? [];
  const index = payments.findIndex((p) => p.id === paymentId);
  if (index === -1) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }
  const payment = payments[index];

  // Payments are appended in the order they were recorded (see
  // recordInvoicePayment in lib/quotes-store.ts), so the running total
  // through-and-including this one is just the sum of everything up to its
  // own index — this keeps an old payment's receipt historically accurate
  // (paid-to-date / balance AS OF that payment) even if more has been paid,
  // or the order's total has changed, since.
  const paidToDate =
    Math.round(payments.slice(0, index + 1).reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  const grandTotal = record.computed.grandTotal;
  const balanceAfter = Math.max(0, Math.round((grandTotal - paidToDate) * 100) / 100);
  const docLabel = record.invoiceNumber
    ? `Invoice ${record.invoiceNumber}`
    : record.quoteNumber
      ? `Quote ${record.quoteNumber}`
      : "your order";
  const methodLabel = payment.method === "square_card" ? "Card" : TENDER_LABEL[payment.tender ?? "other"];

  try {
    const pdfBuffer = await renderPaymentReceiptPdf({
      docLabel,
      customerName: record.computed.customerName,
      customerCompany: record.computed.customerCompany,
      payment: {
        amount: payment.amount,
        methodLabel,
        createdAt: payment.createdAt,
        note: payment.note,
      },
      paidToDate,
      grandTotal,
      balanceAfter,
      payPageUrl: `${req.nextUrl.origin}/pay/${record.id}`,
    });

    const fileNameSafe = (record.computed.customerName || "receipt").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const dateSafe = payment.createdAt.slice(0, 10);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="receipt-${dateSafe}-${fileNameSafe}.pdf"`,
      },
    });
  } catch (err) {
    console.error(`GET /api/pay/${id}/payments/${paymentId}/receipt-pdf failed`, err);
    return NextResponse.json({ error: "Failed to render receipt" }, { status: 500 });
  }
}
