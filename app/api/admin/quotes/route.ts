import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getDecorationTypes } from "@/lib/decoration-types-store";
import { getSetupCharges } from "@/lib/setup-charges-store";
import { getGarmentMarkupSettings } from "@/lib/garment-markup-store";
import { computeQuote, isValidQuoteInput, QuoteInputError } from "@/lib/quote";
import { createQuote, createInvoice, getQuotes } from "@/lib/quotes-store";
import { loadQuoteProducts } from "@/lib/quote-products";
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
    const [productsByStyle, decorations, setupCharges, garmentMarkup] = await Promise.all([
      loadQuoteProducts(body.lines),
      getDecorationTypes(),
      getSetupCharges(),
      getGarmentMarkupSettings(),
    ]);

    const computed = computeQuote(body, productsByStyle, decorations, setupCharges, garmentMarkup.breakpoints);
    // Optional "kind": "invoice" in the request body (not part of QuoteInput
    // itself — isValidQuoteInput ignores unknown fields) lets the admin's
    // "+ New invoice" button create a record that starts life as an invoice
    // directly, instead of always starting as a quote (the default, and the
    // only option before quotes/invoices became separate linkable records).
    const kind = (body as { kind?: unknown }).kind === "invoice" ? "invoice" : "quote";
    const { record, persisted } = kind === "invoice" ? await createInvoice(body, computed) : await createQuote(body, computed);
    return NextResponse.json({ ok: true, record, persisted });
  } catch (err) {
    if (err instanceof QuoteInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/admin/quotes failed", err);
    return NextResponse.json({ error: "Failed to save quote" }, { status: 500 });
  }
}
