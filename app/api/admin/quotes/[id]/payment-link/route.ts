import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { isSquareConfigured } from "@/lib/square-client";
import { refreshOrCreatePaymentLink, SquareNotConfiguredError, PaymentLinkKind } from "@/lib/square-payment-links";
import { getQuote, setInvoicePaymentLink } from "@/lib/quotes-store";

// Admin-only: creates (or refreshes in place, same URL when possible) a
// Square-hosted "Pay online" link for this record's current total — or, for
// a plain quote not yet converted to an invoice, a deposit — and saves it
// onto the record. Mirrors app/api/admin/quotes/[id]/payment/route.ts's
// shape.
//
// Body is optional. { amount } lets the admin type a custom deposit figure;
// omitted, the default is the record's full current total for an invoice,
// or this quote's payment-terms deposit (QuoteInput.depositPercent, 100% —
// "pay in full" — when unset) for a quote. Call again any time to refresh
// the link to a new amount (e.g. after the quote's total changed, or to
// collect the remainder later) — see refreshOrCreatePaymentLink's own
// comment for how it tries to keep the same URL across those refreshes.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSquareConfigured()) {
    return NextResponse.json(
      {
        error:
          "Square isn't configured yet. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in the site's environment variables to enable online payment links.",
      },
      { status: 503 }
    );
  }

  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const grandTotal = record.computed.grandTotal;
  const requestedAmount =
    typeof body?.amount === "number" && Number.isFinite(body.amount) && body.amount > 0
      ? Math.round(body.amount * 100) / 100
      : undefined;

  if (requestedAmount !== undefined && requestedAmount > grandTotal + 0.02) {
    return NextResponse.json(
      { error: `That's more than the current total of $${grandTotal.toFixed(2)}.` },
      { status: 400 }
    );
  }

  const depositPercent = record.computed.depositPercent;
  let amount: number;
  let kind: PaymentLinkKind;
  if (requestedAmount !== undefined) {
    amount = requestedAmount;
    kind = "deposit-fixed";
  } else if (record.status === "invoice") {
    amount = grandTotal;
    kind = "full";
  } else if (depositPercent && depositPercent < 100) {
    amount = Math.round(grandTotal * (depositPercent / 100) * 100) / 100;
    kind = "deposit-percent";
  } else {
    amount = grandTotal;
    kind = "full";
  }

  try {
    const link = await refreshOrCreatePaymentLink(record, amount);
    const { record: updated, persisted } = await setInvoicePaymentLink(id, { ...link, amount, kind });
    if (!updated) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, record: updated, persisted, reused: link.reused });
  } catch (err) {
    if (err instanceof SquareNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("POST /api/admin/quotes/[id]/payment-link failed", err);
    return NextResponse.json({ error: "Failed to create Square payment link" }, { status: 500 });
  }
}
