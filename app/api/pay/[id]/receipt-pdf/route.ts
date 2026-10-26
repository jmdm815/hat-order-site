import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/quotes-store";
import { renderQuotePdf } from "@/lib/quote-pdf";

export const runtime = "nodejs";

// Public, customer-facing — same unguessable-id security model as the rest
// of this page (see app/api/pay/[id]/route.ts's header comment). Lets the
// customer pull their own PDF receipt straight from the pay page once
// something's been paid — on a plain quote's deposit just as well as an
// invoice's balance, matching that same route's support for both — rather
// than relying solely on the opt-in receipt email sent at payment time.
// Renders fresh from the record's current pricing snapshot, same renderer
// the admin's "Download PDF" button and the payment-time receipt email both
// use, so it always reflects the record's up-to-date paid/balance status.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!record.amountPaid || record.amountPaid <= 0) {
    return NextResponse.json({ error: "No payment has been recorded yet" }, { status: 400 });
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
    const fileNameSafe = (record.computed.customerName || "receipt").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const docNumber = record.invoiceNumber ?? record.quoteNumber ?? "receipt";

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${docNumber}-${fileNameSafe}.pdf"`,
      },
    });
  } catch (err) {
    console.error(`GET /api/pay/${id}/receipt-pdf failed`, err);
    return NextResponse.json({ error: "Failed to render receipt" }, { status: 500 });
  }
}
