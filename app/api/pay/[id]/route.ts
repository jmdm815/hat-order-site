import { NextRequest, NextResponse } from "next/server";
import { getQuote, recordInvoicePayment, QuoteRecord } from "@/lib/quotes-store";
import { getSquareClient, getSquareLocationId, isSquareConfigured } from "@/lib/square-client";
import { sendInvoicePaymentNotification, sendInvoiceReceiptEmail } from "@/lib/email";
import { loadLineMockups } from "@/lib/mockup-links";
import { unconfirmedSanmarCosts, unconfirmedCostMessage } from "@/lib/price-check";
import { renderQuotePdf, CHECK_PAYABLE_TO, CHECK_MAIL_TO, ZELLE_EMAIL, ZELLE_PAY_URL } from "@/lib/quote-pdf";

// Loose email format check — good enough to catch obvious typos before
// bothering Resend with it; not trying to be a full RFC 5322 validator.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TENDER_LABEL: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  other: "Other",
};

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Public, customer-facing — intentionally NOT behind isAdminAuthed(). Reached
// only by knowing the record's id (a random uuid in the URL) — one single,
// permanent URL per quote or invoice that never changes, handed to the
// customer via the "Copy pay page link" button in AdminSavedQuotesList.tsx /
// AdminInvoicePaymentModal.tsx. Works on a plain quote (a pre-invoice
// deposit) just as well as a converted invoice — see
// lib/quotes-store.ts's recordInvoicePayment, which already supports both —
// so the customer sees a JM Digital Media-branded summary of what they
// ordered (app/pay/[id]/page.tsx) and can pay all or part of the balance
// with a card — charged directly through Square's Web Payments SDK
// client-side (components/InvoicePayForm.tsx), no redirect to a
// Square-hosted checkout page.
// ---------------------------------------------------------------------------

type CustomerInvoiceSummary = {
  id: string;
  status: "quote" | "invoice";
  invoiceNumber?: string;
  quoteNumber?: string;
  invoiceStatus?: string;
  customerName?: string;
  customerCompany?: string;
  customerEmail?: string;
  quoteDate: string;
  dueDate?: string;
  lines: Array<{
    description: string;
    details?: string[];
    colorName?: string;
    decorationLabel?: string;
    priceColumnLabel?: string;
    quantity: number;
    subtotal: number;
  }>;
  setupCharges: Array<{ id: string; label: string; price: number }>;
  miscFees: Array<{ label: string; amount: number; quantity: number; lineTotal: number }>;
  // Military discount — see lib/quote.ts's QuoteInput.militaryDiscount.
  discountAmount?: number;
  discountPercent?: number;
  // Pay-by-check instructions shown under the card form.
  checkPayableTo: string;
  checkMailTo: string;
  zelleEmail: string;
  zellePayUrl: string;
  grandTotal: number;
  amountPaid: number;
  balance: number;
  // See lib/quote.ts's QuoteInput.depositPercent — undefined/100 means this
  // quote is on "pay in full" terms, so the pay page shouldn't call this a
  // "deposit" anywhere; only a real partial-deposit quote (< 100) should.
  depositPercent?: number;
  // Deposit due under the current terms (the full total on pay-in-full terms).
  depositAmount: number;
  // The admin's saved "amount to pay" (lib/quotes-store.ts's
  // paymentLinkAmount — see setSuggestedPaymentAmount), clamped to the
  // current balance — what InvoicePayClient.tsx pre-fills "Amount to pay"
  // with, instead of always defaulting to the full balance. Undefined if
  // the admin never set one, in which case the client falls back to the
  // full balance like before.
  suggestedAmount?: number;
  // Every payment recorded against this record so far, oldest first — lets
  // the customer see (and get a standalone receipt for) each individual
  // transaction, not just today's running total/balance. See
  // app/api/pay/[id]/payments/[paymentId]/receipt-pdf/route.ts, linked from
  // each row in InvoicePayClient.tsx's payment-history list.
  payments: Array<{
    id: string;
    amount: number;
    methodLabel: string;
    createdAt: string;
    note?: string;
  }>;
};

function toCustomerSummary(record: QuoteRecord): CustomerInvoiceSummary {
  const grandTotal = record.computed.grandTotal;
  const amountPaid = Math.round((record.amountPaid ?? 0) * 100) / 100;
  const balance = Math.max(0, Math.round((grandTotal - amountPaid) * 100) / 100);
  // Deposit due under the record's CURRENT terms, recomputed on every load,
  // so editing the quote/invoice (terms or items) is reflected the next time
  // the same link is opened. Pay-in-full terms: the deposit is the full total.
  const depositPercent = record.computed.depositPercent;
  const hasPartialDeposit = Boolean(depositPercent && depositPercent < 100);
  const depositAmount = hasPartialDeposit
    ? Math.round(grandTotal * (depositPercent! / 100) * 100) / 100
    : grandTotal;
  const depositRemaining = Math.max(0, Math.round((depositAmount - amountPaid) * 100) / 100);

  // What "Amount to pay" is pre-filled with:
  //  - "deposit-fixed": a specific dollar amount the admin typed — respected.
  //  - "full": the admin chose to ask for the full balance.
  //  - otherwise (incl. "deposit-percent" and no saved link amount): follow
  //    the current terms — what's still owed toward the deposit, then the
  //    remaining balance once the deposit is covered.
  let suggestedAmount: number | undefined;
  if (record.paymentLinkKind === "deposit-fixed" && (record.paymentLinkAmount ?? 0) > 0) {
    suggestedAmount = Math.min(record.paymentLinkAmount!, balance);
  } else if (record.paymentLinkKind === "full") {
    suggestedAmount = balance > 0 ? balance : undefined;
  } else if (hasPartialDeposit && depositRemaining > 0) {
    suggestedAmount = Math.min(depositRemaining, balance);
  }
  return {
    id: record.id,
    status: record.status,
    invoiceNumber: record.invoiceNumber,
    quoteNumber: record.quoteNumber,
    invoiceStatus: record.invoiceStatus,
    customerName: record.computed.customerName,
    customerCompany: record.computed.customerCompany,
    customerEmail: record.computed.customerEmail,
    quoteDate: record.computed.quoteDate,
    // Invoice-only (see lib/quote.ts's QuoteInput.dueDate) — never surfaced
    // for a plain quote, even if one somehow had it set.
    dueDate: record.status === "invoice" ? record.computed.dueDate : undefined,
    lines: record.computed.lines.map((l) => ({
      description: l.customerSupplied
        ? (l.itemDescription || "Customer-supplied item").split("\n")[0].trim()
        : [l.brandName, l.productName].filter(Boolean).join(" "),
      // Extra description lines (everything after the first line).
      details: (l.customerSupplied ? l.itemDescription ?? "" : "")
        .split("\n")
        .slice(1)
        .map((d) => d.trim())
        .filter(Boolean),
      colorName: l.customerSupplied ? undefined : l.colorName,
      decorationLabel: l.decorationLabel,
      priceColumnLabel: l.priceColumnLabel,
      quantity: l.quantity,
      subtotal: l.subtotal,
    })),
    setupCharges: record.computed.setupCharges,
    miscFees: record.computed.miscFees,
    ...((record.computed.discountAmount ?? 0) > 0
      ? { discountAmount: record.computed.discountAmount, discountPercent: record.computed.militaryDiscountPercent }
      : {}),
    checkPayableTo: CHECK_PAYABLE_TO,
    checkMailTo: CHECK_MAIL_TO,
    zelleEmail: ZELLE_EMAIL,
    zellePayUrl: ZELLE_PAY_URL,
    grandTotal,
    amountPaid,
    balance,
    depositPercent: record.computed.depositPercent,
    depositAmount,
    suggestedAmount,
    payments: (record.payments ?? []).map((p) => ({
      id: p.id,
      amount: p.amount,
      methodLabel: (p.method === "square_card" ? "Card" : TENDER_LABEL[p.tender ?? "other"] + (p.tender === "check" && p.checkNumber ? ` #${p.checkNumber}` : "")),
      createdAt: p.createdAt,
      note: p.note,
    })),
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (unconfirmedSanmarCosts(record.computed).length) {
    return NextResponse.json(
      { error: "This quote is still being finalized. Please check back shortly or contact us.", pending: true },
      { status: 409 }
    );
  }
  return NextResponse.json({ invoice: toCustomerSummary(record) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (unconfirmedSanmarCosts(record.computed).length) {
    return NextResponse.json(
      { error: "This quote is still being finalized. Please check back shortly or contact us.", pending: true },
      { status: 409 }
    );
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
      note: record.invoiceNumber
        ? `Invoice ${record.invoiceNumber}`
        : record.quoteNumber
          ? `Quote ${record.quoteNumber}${
              record.computed.depositPercent && record.computed.depositPercent < 100 ? " deposit" : ""
            }`
          : `Payment ${id.slice(0, 8)}`,
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
        const pdfBuffer = await renderQuotePdf(updated.computed, updated.status === "invoice" ? "invoice" : "customer", {
      lineMockups: await loadLineMockups(updated, "customer"),
          invoiceNumber: updated.invoiceNumber,
          invoiceStatus: updated.invoiceStatus,
          quoteNumber: updated.quoteNumber,
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
