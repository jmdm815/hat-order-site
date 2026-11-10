import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { loadLineMockups } from "@/lib/mockup-links";
import { renderQuotePdf, QuotePdfMode } from "@/lib/quote-pdf";
import { getQuote } from "@/lib/quotes-store";

export const runtime = "nodejs";

// Renders a PDF straight from a saved quote/invoice's stored pricing
// snapshot (lib/quotes-store.ts) — no recomputation, so the document always
// matches what was actually saved/sent, even if catalog or decoration
// pricing has since changed. ?mode= selects which of the four renderings
// (customer/internal/work-order/invoice) to produce; "invoice" is only
// meaningful once the record has been converted (see .../convert).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const rawMode = req.nextUrl.searchParams.get("mode");
  const mode: QuotePdfMode =
    rawMode === "internal"
      ? "internal"
      : rawMode === "work-order"
        ? "work-order"
        : rawMode === "invoice" && record.status === "invoice"
          ? "invoice"
          : "customer";

  try {
    const pdfBuffer = await renderQuotePdf(record.computed, mode, {
      lineMockups: await loadLineMockups(record, (mode) === "internal" || (mode) === "work-order" ? "internal" : "customer"),
      invoiceNumber: record.invoiceNumber,
      invoiceStatus: record.invoiceStatus,
      paymentLinkUrl: record.paymentLinkUrl,
      payPageUrl: `${req.nextUrl.origin}/pay/${record.id}`,
      amountPaid: record.amountPaid,
      quoteNumber: record.quoteNumber,
    });
    const fileNameSafe = (record.computed.customerName || "quote")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();
    const filePrefix =
      mode === "work-order" ? "work-order" : mode === "invoice" ? record.invoiceNumber ?? "invoice" : "quote";
    const suffix = mode === "internal" ? "-internal" : "";

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // "inline" (not "attachment") — the tab this is opened in renders
        // the PDF instead of force-downloading it, but the filename is
        // still what the browser's own "Save As"/download action in that
        // viewer proposes. This is what actually determines the saved
        // filename on a real navigation (vs. the client's own earlier
        // fetch+Blob approach, whose "File" wrapper trick several browsers
        // don't actually honor — see lib/client-download.ts and each
        // downloadPdf's comment for why they navigate here directly now).
        "Content-Disposition": `inline; filename="${filePrefix}-${fileNameSafe}-${record.computed.quoteDate}${suffix}.pdf"`,
      },
    });
  } catch (err) {
    console.error("GET /api/admin/quotes/[id]/pdf failed", err);
    return NextResponse.json({ error: "Failed to render PDF" }, { status: 500 });
  }
}
