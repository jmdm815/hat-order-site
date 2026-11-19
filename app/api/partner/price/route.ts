import { NextRequest, NextResponse } from "next/server";
import { isPartnerAuthed } from "@/lib/partner-auth";
import { PartnerInputError, toQuoteInput } from "@/lib/partner-pricing";
import { getDecorationTypes } from "@/lib/decoration-types-store";
import { getSetupCharges } from "@/lib/setup-charges-store";
import { getGarmentMarkupSettings } from "@/lib/garment-markup-store";
import { computeQuote, QuoteInputError } from "@/lib/quote";
import { loadQuoteProducts } from "@/lib/quote-products";

export const maxDuration = 60;

// POST /api/partner/price — prices a partner's items at JM Media's sell price
// (live garment cost + markup table + digital print tiers on the combined
// quantity). Returns only per-size unit prices, never cost or markup. A size
// whose live account price couldn't be fetched comes back unavailable rather
// than falling back to the catalog list price.
export async function POST(req: NextRequest) {
  if (!(await isPartnerAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = toQuoteInput(await req.json().catch(() => null));
    const [products, decorations, setupCharges, markup] = await Promise.all([
      loadQuoteProducts(input.lines),
      getDecorationTypes(),
      getSetupCharges(),
      getGarmentMarkupSettings(),
    ]);
    const q = computeQuote(input, products, decorations, setupCharges, markup.breakpoints);
    const lines = q.lines.map((l, i) => ({
      id: input.lines[i]?.lineId,
      productName: l.productName,
      brandName: l.brandName,
      styleNumber: l.styleNumber,
      colorName: l.colorName,
      decorationLabel: l.decorationId ? `${l.decorationLabel ?? "Digital Print"} · ${l.priceColumnLabel ?? ""}`.trim() : "",
      sizes: l.sizes.map((s) => {
        const unavailable = !input.lines[i]?.customerSupplied && s.costSource === "catalog";
        return {
          size: s.size,
          quantity: s.quantity,
          garmentUnitPrice: unavailable ? null : s.garmentUnitPrice,
          decorationUnitPrice: s.decorationUnitPrice,
          unitPrice: unavailable ? null : s.unitPrice,
          unavailable,
        };
      }),
    }));
    const addons = q.setupCharges.map((c) => ({ id: c.id, label: c.label, price: c.price }));
    return NextResponse.json({ lines, addons });
  } catch (err) {
    if (err instanceof PartnerInputError || err instanceof QuoteInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/partner/price failed", err);
    return NextResponse.json({ error: "Couldn't price that right now" }, { status: 500 });
  }
}
