import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getDecorationTypes } from "@/lib/decoration-types-store";
import { getSetupCharges } from "@/lib/setup-charges-store";
import { getGarmentMarkupSettings } from "@/lib/garment-markup-store";
import { computeQuote, QuoteInput, QuoteInputError } from "@/lib/quote";
import { renderQuotePdf, QuotePdfMode } from "@/lib/quote-pdf";
import { unconfirmedSanmarCosts, unconfirmedCostMessage } from "@/lib/price-check";
import { loadQuoteProducts } from "@/lib/quote-products";

export const runtime = "nodejs";

// Admin-only: same input as POST /api/admin/quote, but streams back a
// rendered PDF instead of the JSON breakdown, for the "Download PDF" button.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = (await req.json().catch(() => null)) as (QuoteInput & { mode?: string }) | null;
  if (!raw || !Array.isArray(raw.lines) || raw.lines.length === 0) {
    return NextResponse.json({ error: "Invalid quote input" }, { status: 400 });
  }
  const mode: QuotePdfMode =
    raw.mode === "internal" ? "internal" : raw.mode === "work-order" ? "work-order" : "customer";
  const body: QuoteInput = raw;

  try {
    const [productsByStyle, decorations, setupCharges, garmentMarkup] = await Promise.all([
      loadQuoteProducts(body.lines),
      getDecorationTypes(),
      getSetupCharges(),
      getGarmentMarkupSettings(),
    ]);

    const quote = computeQuote(body, productsByStyle, decorations, setupCharges, garmentMarkup.breakpoints);
    if (mode === "customer") {
      const unconfirmed = unconfirmedSanmarCosts(quote);
      if (unconfirmed.length) {
        return NextResponse.json({ error: unconfirmedCostMessage(unconfirmed), unconfirmed }, { status: 409 });
      }
    }
    const pdfBuffer = await renderQuotePdf(quote, mode);
    const fileNameSafe = (quote.customerName || "quote").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const filePrefix = mode === "work-order" ? "work-order" : "quote";
    const suffix = mode === "internal" ? "-internal" : "";

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // "inline" — see app/api/admin/quotes/[id]/pdf/route.ts's comment.
        "Content-Disposition": `inline; filename="${filePrefix}-${fileNameSafe}-${quote.quoteDate}${suffix}.pdf"`,
      },
    });
  } catch (err) {
    if (err instanceof QuoteInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/admin/quote/pdf failed", err);
    return NextResponse.json({ error: "Failed to render quote PDF" }, { status: 500 });
  }
}
