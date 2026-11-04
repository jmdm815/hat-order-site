import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getDecorationTypes } from "@/lib/decoration-types-store";
import { getSetupCharges } from "@/lib/setup-charges-store";
import { getGarmentMarkupSettings } from "@/lib/garment-markup-store";
import { computeQuote, isValidQuoteInput, QuoteInputError } from "@/lib/quote";
import { deleteQuote, getQuote, updateQuoteContent, setSuggestedPaymentAmount } from "@/lib/quotes-store";
import { loadQuoteProducts } from "@/lib/quote-products";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  return NextResponse.json({ record });
}

// Re-price and overwrite a saved record's input/computed snapshot — used
// both to save edits (customer info, lines, setup charges) and to refresh
// pricing against the current catalog/decoration rates. Works regardless of
// whether the record has already been converted to an invoice; the
// invoiceNumber/status/payment fields are left untouched either way.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
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
    const { record, persisted } = await updateQuoteContent(id, body, computed);
    if (!record) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    // If this record already has a suggested pay-page amount that
    // auto-tracks the total (kind "full" — an invoice — or "deposit-percent"
    // — a quote's payment-terms deposit), keep that figure in sync with
    // whatever the edit just changed — the pay page itself always reflects
    // the record's current total/balance regardless, this only keeps its
    // pre-filled "Amount to pay" accurate. A "deposit-fixed" amount (the
    // admin typed a specific dollar figure) is left untouched — editing the
    // quote shouldn't silently change a deposit amount the admin chose on
    // purpose. Best-effort: a failure here never fails the save itself.
    let finalRecord = record;
    if (record.paymentLinkKind && record.paymentLinkKind !== "deposit-fixed") {
      try {
        const grandTotal = record.computed.grandTotal;
        const depositPercent = record.computed.depositPercent;
        const targetAmount =
          record.paymentLinkKind === "full"
            ? grandTotal
            : depositPercent && depositPercent < 100
              ? Math.round(grandTotal * (depositPercent / 100) * 100) / 100
              : grandTotal;
        if (Math.abs(targetAmount - (record.paymentLinkAmount ?? -1)) > 0.004 && targetAmount > 0) {
          const { record: withAmount } = await setSuggestedPaymentAmount(id, {
            amount: targetAmount,
            kind: record.paymentLinkKind,
          });
          if (withAmount) finalRecord = withAmount;
        }
      } catch (err) {
        console.error("PUT /api/admin/quotes/[id]: auto-refresh of suggested payment amount failed", err);
      }
    }

    return NextResponse.json({ ok: true, record: finalRecord, persisted });
  } catch (err) {
    if (err instanceof QuoteInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("PUT /api/admin/quotes/[id] failed", err);
    return NextResponse.json({ error: "Failed to update quote" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { deleted, persisted } = await deleteQuote(id);
  if (!deleted) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, persisted });
}
