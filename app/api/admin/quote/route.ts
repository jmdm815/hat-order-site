import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getDecorationTypes } from "@/lib/decoration-types-store";
import { getSetupCharges } from "@/lib/setup-charges-store";
import { getGarmentMarkupSettings } from "@/lib/garment-markup-store";
import { computeQuote, isValidQuoteInput, QuoteInputError } from "@/lib/quote";
import { loadQuoteProducts } from "@/lib/quote-products";

// Admin-only: compute a fully priced quote (garment price by size, live
// decoration pricing at the combined order quantity, setup fees) without
// touching the cart/checkout flow at all — this is a standalone tool for
// generating one-off customer quotes. See /api/admin/quote/pdf to render the
// result as a downloadable PDF.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!isValidQuoteInput(body)) {
    return NextResponse.json({ error: "Invalid quote input" }, { status: 400 });
  }

  try {
    const [productsByStyle, decorations, setupCharges, garmentMarkup] = await Promise.all([
      loadQuoteProducts(body.lines),
      getDecorationTypes(),
      getSetupCharges(),
      getGarmentMarkupSettings(),
    ]);

    const quote = computeQuote(body, productsByStyle, decorations, setupCharges, garmentMarkup.breakpoints);
    return NextResponse.json({ quote });
  } catch (err) {
    if (err instanceof QuoteInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/admin/quote failed", err);
    return NextResponse.json({ error: "Failed to compute quote" }, { status: 500 });
  }
}
