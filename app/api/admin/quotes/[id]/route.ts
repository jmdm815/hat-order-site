import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getDecorationTypes } from "@/lib/decoration-types-store";
import { getSetupCharges } from "@/lib/setup-charges-store";
import { getGarmentMarkupSettings } from "@/lib/garment-markup-store";
import { computeQuote, isValidQuoteInput, QuoteInputError } from "@/lib/quote";
import { deleteQuote, getQuote, updateQuoteContent, setInvoicePaymentLink } from "@/lib/quotes-store";
import { refreshOrCreatePaymentLink } from "@/lib/square-payment-links";
import { isSquareConfigured } from "@/lib/square-client";
import { getCatalog } from "@/lib/sanmar";
import { applyLiveSanmarPricingToProducts } from "@/lib/sanmar-pricing";
import { Product } from "@/lib/types";

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
      body.lines.map((l) => l.styleNumber).filter((s): s is string => Boolean(s))
    );

    const computed = computeQuote(body, productsByStyle, decorations, setupCharges, garmentMarkup.breakpoints);
    const { record, persisted } = await updateQuoteContent(id, body, computed);
    if (!record) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    // If this record already has a Square payment link and its amount
    // auto-tracks the total (kind "full" — an invoice — or "deposit-percent"
    // — a quote's payment-terms deposit), keep that link in sync with
    // whatever the edit just changed, reusing the same URL whenever Square
    // allows it (see refreshOrCreatePaymentLink's comment). A
    // "deposit-fixed" link (the admin typed a specific dollar figure) is
    // left untouched — editing the quote shouldn't silently change a
    // deposit amount the admin chose on purpose. Best-effort: a failure
    // here never fails the save itself, it just leaves the existing link as
    // the user's only recourse until they refresh it by hand.
    let finalRecord = record;
    if (
      record.paymentLinkUrl &&
      record.paymentLinkKind &&
      record.paymentLinkKind !== "deposit-fixed" &&
      isSquareConfigured()
    ) {
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
          const link = await refreshOrCreatePaymentLink(record, targetAmount);
          const { record: withLink } = await setInvoicePaymentLink(id, {
            ...link,
            amount: targetAmount,
            kind: record.paymentLinkKind,
          });
          if (withLink) finalRecord = withLink;
        }
      } catch (err) {
        console.error("PUT /api/admin/quotes/[id]: auto-refresh of payment link failed", err);
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
