import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/quotes-store";
import { renderQuotePdf } from "@/lib/quote-pdf";
import { sendInvoiceReceiptEmail, isReceiptEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public, customer-facing — "Email receipt" on the pay page, once something's
// been paid — on a plain quote's deposit just as well as an invoice's
// balance, matching app/api/pay/[id]/route.ts's support for both. One
// address per request (the UI resubmits for each additional address, same
// as the "add one at a time" flow on the admin's own "Send to customer"
// feature) rather than taking an array like the admin version — this is
// unauthenticated and reachable by anyone who has the pay link, so there's
// no admin typing in a batch of addresses to validate against; keeping it
// to one explicit address per submit keeps each request's intent
// unambiguous.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!record.amountPaid || record.amountPaid <= 0) {
    return NextResponse.json({ error: "No payment has been recorded yet" }, { status: 400 });
  }
  if (!isReceiptEmailConfigured()) {
    return NextResponse.json({ error: "Email isn't available right now" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    const payPageUrl = `${req.nextUrl.origin}/pay/${record.id}`;
    const pdfBuffer = await renderQuotePdf(record.computed, record.status === "invoice" ? "invoice" : "customer", {
      invoiceNumber: record.invoiceNumber,
      invoiceStatus: record.invoiceStatus,
      quoteNumber: record.quoteNumber,
      paymentLinkUrl: record.paymentLinkUrl,
      payPageUrl,
      amountPaid: record.amountPaid,
    });

    // Reflect the most recent actual payment in the email body (amount +
    // method) when one's on record; fall back to the running total for a
    // record marked paid by hand with no tracked payment entries.
    const lastPayment = record.payments?.[record.payments.length - 1];
    const grandTotal = record.computed.grandTotal;
    const amountPaid = Math.round((record.amountPaid ?? 0) * 100) / 100;
    const balance = Math.max(0, Math.round((grandTotal - amountPaid) * 100) / 100);
    const docNumber = record.invoiceNumber ?? record.quoteNumber ?? "receipt";

    await sendInvoiceReceiptEmail({
      to: email,
      invoiceNumber: record.invoiceNumber,
      quoteNumber: record.quoteNumber,
      customerName: record.computed.customerName,
      customerCompany: record.computed.customerCompany,
      amount: lastPayment?.amount ?? amountPaid,
      method: lastPayment?.method ?? "manual",
      grandTotal,
      amountPaid,
      balance,
      payPageUrl,
      pdf: {
        filename: `${docNumber}.pdf`,
        content: pdfBuffer,
      },
    });

    return NextResponse.json({ ok: true, sentTo: email });
  } catch (err) {
    console.error(`POST /api/pay/${id}/receipt-email failed`, err);
    const message = err instanceof Error ? err.message : "Failed to send receipt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
