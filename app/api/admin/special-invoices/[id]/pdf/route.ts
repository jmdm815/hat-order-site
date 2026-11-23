import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote } from "@/lib/quotes-store";
import { loadLineMockups } from "@/lib/mockup-links";
import { renderQuotePdf } from "@/lib/quote-pdf";
import { getSpecialInvoice, specialInvoicePdfQuote } from "@/lib/special-invoices-store";

export const runtime = "nodejs";

// Same invoice layout as the normal invoice PDF (lib/quote-pdf.ts), with the
// reseller-adjusted pricing, the SI number, and no online pay link.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const si = await getSpecialInvoice((await params).id);
  if (!si) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const source = await getQuote(si.sourceId);
  const lineMockups = source ? await loadLineMockups(source, "customer").catch(() => ({})) : {};
  const pdf = await renderQuotePdf(specialInvoicePdfQuote(si), "invoice", {
    lineMockups,
    invoiceNumber: si.number,
    invoiceStatus: si.status,
  });
  const who = (si.source.customerCompany || si.source.customerName || "customer").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const disposition = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${si.number}-${who}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
