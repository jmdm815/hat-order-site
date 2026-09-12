import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getDecorationTypes } from "@/lib/decoration-types-store";
import { getSetupCharges } from "@/lib/setup-charges-store";
import { getGarmentMarkupSettings } from "@/lib/garment-markup-store";
import { computeQuote, isValidQuoteInput, QuoteInputError } from "@/lib/quote";
import { createQuote, getQuotes } from "@/lib/quotes-store";
import { getCatalog } from "@/lib/sanmar";
import { applyLiveSanmarPricingToProducts } from "@/lib/sanmar-pricing";
import { Product } from "@/lib/types";
import { isPersistent } from "@/lib/pricing-store";

// Admin-only: saved quotes live here so they persist on the site instead of
// only existing for as long as the builder tab stays open. GET lists every
// saved quote/invoice (newest first); POST computes pricing from the given
// input (same engine as /api/admin/quote) and persists the result.
export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const quotes = await getQuotes();
  return NextResponse.json({ quotes, persistent: isPersistent() });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!isValidQuoteInput(body)) {
    return NextResponse.json({ error: "Invalid quote input" }, { status: 400 });
  }

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

    const computed = computeQuote(body, productsByStyle, decorations, setupCharges, garmentMarkup.breakpoints);
    const { record, persisted } = await createQuote(body, computed);
    return NextResponse.json({ ok: true, record, persisted });
  } catch (err) {
    if (err instanceof QuoteInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/admin/quotes failed", err);
    return NextResponse.json({ error: "Failed to save quote" }, { status: 500 });
  }
}
