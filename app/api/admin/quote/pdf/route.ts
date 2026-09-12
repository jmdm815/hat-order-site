import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getDecorationTypes } from "@/lib/decoration-types-store";
import { getSetupCharges } from "@/lib/setup-charges-store";
import { getGarmentMarkupSettings } from "@/lib/garment-markup-store";
import { computeQuote, QuoteInput, QuoteInputError } from "@/lib/quote";
import { renderQuotePdf, QuotePdfMode } from "@/lib/quote-pdf";
import { getCatalog } from "@/lib/sanmar";
import { applyLiveSanmarPricingToProducts } from "@/lib/sanmar-pricing";
import { Product } from "@/lib/types";

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
    const [hats, shirts, polos, decorations, setupCharges, garmentMarkup] = await Promise.all([
      getCatalog("hat"),
      getCatalog("shirt"),
      getCatalog("polo"),
      getDecorationTypes(),
      getSetupCharges(),
      getGarmentMarkupSettings(),
    ]);
    const productsByStyle = new Map<string, Product>();
    for (const p of [...hats, ...shirts, ...polos]) {
      productsByStyle.set(p.styleNumber, p);
    }
    // Overlay real, account-specific SanMar pricing (lib/sanmar-pricing.ts)
    // on top of the bulk catalog feed's standard/list price for just the
    // styles this quote actually uses — see app/api/admin/quote/route.ts for
    // the full rationale. Falls back to catalog pricing per-style on failure.
    await applyLiveSanmarPricingToProducts(
      productsByStyle,
      body.lines.map((l) => l.styleNumber)
    );

    const quote = computeQuote(body, productsByStyle, decorations, setupCharges, garmentMarkup.breakpoints);
    const pdfBuffer = await renderQuotePdf(quote, mode);
    const fileNameSafe = (quote.customerName || "quote").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const filePrefix = mode === "work-order" ? "work-order" : "quote";
    const suffix = mode === "internal" ? "-internal" : "";

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filePrefix}-${fileNameSafe}-${quote.quoteDate}${suffix}.pdf"`,
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
