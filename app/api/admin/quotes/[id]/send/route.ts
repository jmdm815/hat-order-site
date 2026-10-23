import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { renderQuotePdf, QuotePdfMode } from "@/lib/quote-pdf";
import { getQuote } from "@/lib/quotes-store";
import { sendQuoteDocumentEmail, isReceiptEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";

// Loose email format check — same as every other email entry point in the
// app (app/api/pay/[id]/route.ts, components/InvoicePayClient.tsx).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Admin-only: "Send to customer" — emails the same PDF the admin can
// download (rendered fresh from the record's stored pricing snapshot, same
// as app/api/admin/quotes/[id]/pdf/route.ts) to one or more addresses the
// admin supplies. Quote mode for a "quote" record, invoice mode for a
// converted "invoice" record — mirrors the mode logic in the PDF route so
// a sent email always matches what "Download PDF" would produce. Email only
// for now (see lib/email.ts's SendQuoteDocumentEmail comment) — SMS is a
// planned follow-up, not wired up yet.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isReceiptEmailConfigured()) {
    return NextResponse.json(
      { error: "Email isn't configured yet on this deployment (RESEND_API_KEY is not set)." },
      { status: 503 }
    );
  }

  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const rawEmails = body?.emails;
  if (!Array.isArray(rawEmails) || rawEmails.length === 0) {
    return NextResponse.json({ error: "Add at least one email address." }, { status: 400 });
  }
  const emails = [...new Set(rawEmails.map((e) => String(e).trim().toLowerCase()))];
  const invalid = emails.find((e) => !EMAIL_RE.test(e));
  if (invalid) {
    return NextResponse.json({ error: `"${invalid}" doesn't look like a valid email address.` }, { status: 400 });
  }

  const mode: QuotePdfMode = record.status === "invoice" ? "invoice" : "customer";
  const label =
    record.status === "invoice"
      ? `Invoice ${record.invoiceNumber ?? ""}`.trim()
      : `Quote ${record.quoteNumber ?? ""}`.trim();

  try {
    const pdfBuffer = await renderQuotePdf(record.computed, mode, {
      invoiceNumber: record.invoiceNumber,
      invoiceStatus: record.invoiceStatus,
      paymentLinkUrl: record.paymentLinkUrl,
      payPageUrl: `${req.nextUrl.origin}/pay/${record.id}`,
      amountPaid: record.amountPaid,
      quoteNumber: record.quoteNumber,
    });

    const fileNameSafe = (record.computed.customerName || "quote").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const filePrefix = record.status === "invoice" ? (record.invoiceNumber ?? "invoice") : "quote";

    await sendQuoteDocumentEmail({
      to: emails,
      kind: record.status === "invoice" ? "invoice" : "quote",
      label: label || (record.status === "invoice" ? "your invoice" : "your quote"),
      customerName: record.computed.customerName,
      customerCompany: record.computed.customerCompany,
      grandTotal: record.computed.grandTotal,
      payPageUrl: record.status === "invoice" ? `${req.nextUrl.origin}/pay/${record.id}` : undefined,
      pdf: {
        filename: `${filePrefix}-${fileNameSafe}-${record.computed.quoteDate}.pdf`,
        content: pdfBuffer,
      },
    });

    return NextResponse.json({ ok: true, sentTo: emails });
  } catch (err) {
    console.error("POST /api/admin/quotes/[id]/send failed", err);
    const message = err instanceof Error ? err.message : "Failed to send email";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
