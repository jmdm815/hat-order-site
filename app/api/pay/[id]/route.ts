import { NextRequest, NextResponse } from "next/server";
import { getQuote, recordInvoicePayment, QuoteRecord } from "@/lib/quotes-store";
import { getSquareClient, getSquareLocationId, isSquareConfigured } from "@/lib/square-client";
import { sendInvoicePaymentNotification, sendInvoiceReceiptEmail } from "@/lib/email";
import { renderQuotePdf } from "@/lib/quote-pdf";

// Loose email format check — good enough to catch obvious typos before
// bothering Resend with it; not trying to be a full RFC 5322 validator.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Public, customer-facing — intentionally NOT behind isAdminAuthed(). Reached
// only by knowing the invoice's id (a random uuid in the URL), the same
// unguessable-link security model already used by the Square-hosted payment
// links this complements (see lib/square-payment-links.ts). The admin hands
// this URL to the customer via the "Copy pay page link" button in
// AdminSavedQuotesList.tsx, instead of (or alongside) a Square-hosted
// checkout link, so the customer sees a JM Digital Media-branded summary of
// what they ordered (app/pay/[id]/page.tsx) and can pay all or part of the
// balance with a card — charged directly through Square's Web Payments SDK
// client-side (components/InvoicePayForm.tsx), no redirect to Square's own
// checkout page.
// ---------------------------------------------------------------------------

type CustomerInvoiceSummary = {
  id: string;
  invoiceNumber?: string;
  invoiceStatus?: string;
  customerName?: string;
  customerCompany?: string;
  customerEmail?: string;
  quoteDate: string;
  lines: Array<{
    description: string;
    colorName?: string;
    decorationLabel?: string;
    priceColumnLabel?: string;
    quantity: number;
    subtotal: number;
  }>;
  setupCharges: Array<{ id: string; label: string; price: number }>;
  miscFees: Array<{ label: string; amount: number }>;
  grandTotal: number;
  amountPaid: number;
  balance: number;
};

function toCustomerSummary(record: QuoteRecord): CustomerInvoiceSummary {
  const grandTotal = record.computed.grandTotal;
  const amountPaid = Math.round((record.amountPaid ?? 0) * 100) / 100;
  const balance = Math.max(0, Math.round((grandTotal - amountPaid) * 100) / 100);
  return {
    id: record.id,
    invoiceNumber: record.invoiceNumber,
    invoiceStatus: record.invoiceStatus,
    customerName: record.computed.customerName,
    customerCompany: record.computed.customerCompany,
    customerEmail: record.computed.customerEmail,
    quoteDate: record.computed.quoteDate,
    lines: record.computed.lines.map((l) => ({
      description: l.customerSupplied
        ? l.itemDescription || "Customer-supplied item"
        : [l.brandName, l.productName].filter(Boolean).join(" "),
      colorName: l.customerSupplied ? undefined : l.colorName,
      decorationLabel: l.decorationLabel,
      priceColumnLabel: l.priceColumnLabel,
      quantity: l.quantity,
      subtotal: l.subtotal,
    })),
    setupCharges: record.computed.setupCharges,
    miscFees: record.computed.miscFees,
    grandTotal,
    amountPaid,
    balance,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getQuote(id);
  if (!record || record.status !== "invoice") {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  return NextResponse.json({ invoice: toCustomerSummary(record) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getQuote(id);
  if (!record || record.status !== "invoice") {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const sourceId = body?.sourceId;
  const amount = Number(body?.amount);
  // Which Square Web Payments SDK flow produced the token — purely
  // cosmetic (used in the admin notification email below), doesn't affect
  // how the charge itself is processed. Falls back to "card" for any
  // unrecognized/missing value rather than rejecting the payment over it.
  const walletMethod: "card" | "apple_pay" | "google_pay" =
    body?.method === "apple_pay" || body?.method === "google_pay" ? body.method : "card";
  // Optional — the customer can type an email on the pay page to get a PDF
  // receipt; left blank, payment proceeds exactly as before. Invalid-looking
  // input is just dropped rather than rejecting the whole payment over it.
  const receiptEmail: string | null =
    typeof body?.email === "string" && EMAIL_RE.test(body.email.trim()) ? body.email.trim() : null;
  if (typeof sourceId !== "string" || !sourceId) {
    return NextResponse.json({ error: "Missing payment source" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
  }

  const grandTotal = record.computed.grandTotal;
  const alreadyPaid = record.amountPaid ?? 0;
  const balance = Math.round((grandTotal - alreadyPaid) * 100) / 100;
  // A couple cents of slack for float dust, but never let the customer
  // overpay the invoice through this page.
  if (amount > balance + 0.02) {
    return NextResponse.json(
      { error: `That amount is more than the remaining balance of $${balance.toFixed(2)}.` },
      { status: 400 }
    );
  }

  if (!isSquareConfigured()) {
    return NextResponse.json({ error: "Online payment isn't available right now" }, { status: 503 });
  }

  try {
    const client = getSquareClient();
    const result = await client.payments.create({
      sourceId,
      // Square caps idempotency_key at 45 characters — the invoice's full
      // uuid (36 chars) plus a "-" and a millisecond timestamp (13 digits)
      // ran to 50 and got rejected with VALUE_TOO_LONG, so this uses a
      // short id prefix instead. Still effectively unique per request (the
      // timestamp alone already is), and still traceable back to the
      // invoice from the first 8 characters if needed.
      idempotencyKey: `${id.slice(0, 8)}-${Date.now()}`,
      amountMoney: { amount: BigInt(Math.round(amount * 100)), currency: "USD" },
      locationId: getSquareLocationId(),
      referenceId: id,
      note: record.invoiceNumber ? `Invoice ${record.invoiceNumber}` : `Invoice payment ${id.slice(0, 8)}`,
    });

    if (!result.payment?.id) {
      throw new Error("Square did not return a payment confirmation");
    }

    const { record: updated, persisted } = await recordInvoicePayment(id, {
      amount,
      method: "square_card",
      squarePaymentId: result.payment.id,
    });
    if (!updated) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const summary = toCustomerSummary(updated);
    // Best-effort — never blocks or fails the response to the customer; the
    // charge already succeeded with Square regardless of whether this email
    // goes out.
    void sendInvoicePaymentNotification({
      invoiceId: id,
      invoiceNumber: updated.invoiceNumber,
      customerName: updated.computed.customerName,
      customerCompany: updated.computed.customerCompany,
      amount,
      method: walletMethod === "apple_pay" ? "square_apple_pay" : walletMethod === "google_pay" ? "square_google_pay" : "square_card",
      grandTotal: summary.grandTotal,
      amountPaid: summary.amountPaid,
      balance: summary.balance,
      payPageUrl: `${req.nextUrl.origin}/pay/${id}`,
    });

    if (receiptEmail) {
      // Best-effort — a failed receipt email never fails the payment
      // response (the charge already succeeded with Square regardless).
      // Awaited rather than fire-and-forget like the admin notification
      // above: this does real work (rendering a PDF) that's worth not
      // risking getting cut off if the serverless function freezes right
      // after the response is sent. Renders the invoice PDF fresh (same
      // renderer the admin's "PDF" button uses) so the attachment already
      // reflects this payment's updated paid/balance status.
      try {
        const payPageUrl = `${req.nextUrl.origin}/pay/${id}`;
        const pdfBuffer = await renderQuotePdf(updated.computed, "invoice", {
          invoiceNumber: updated.invoiceNumber,
          invoiceStatus: updated.invoiceStatus,
          paymentLinkUrl: updated.paymentLinkUrl,
          payPageUrl,
          amountPaid: updated.amountPaid,
        });
        await sendInvoiceReceiptEmail({
          to: receiptEmail,
          invoiceNumber: updated.invoiceNumber,
          customerName: updated.computed.customerName,
          customerCompany: updated.computed.customerCompany,
          amount,
          method:
            walletMethod === "apple_pay"
              ? "square_apple_pay"
              : walletMethod === "google_pay"
                ? "square_google_pay"
                : "square_card",
          grandTotal: summary.grandTotal,
          amountPaid: summary.amountPaid,
          balance: summary.balance,
          payPageUrl,
          pdf: {
            filename: `${updated.invoiceNumber ?? "invoice"}.pdf`,
            content: pdfBuffer,
          },
        });
      } catch (err) {
        console.error(`POST /api/pay/${id}: failed to build/send receipt PDF`, err);
      }
    }

    return NextResponse.json({ ok: true, invoice: summary, persisted });
  } catch (err) {
    console.error(`POST /api/pay/${id} failed`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Payment failed" },
      { status: 500 }
    );
  }
}
