import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote, setSuggestedPaymentAmount } from "@/lib/quotes-store";
import type { PaymentLinkKind } from "@/lib/square-payment-links";

// Admin-only: sets (or updates) the "amount to pay" that pre-fills this
// record's permanent, branded pay page (app/pay/[id]) — reached by the
// "Save deposit amount" action in AdminInvoicePaymentModal.tsx. No Square
// Payment Link/Order is created here (that's the whole point of this
// change — see lib/quotes-store.ts's comment on paymentLinkUrl/
// paymentLinkId/squareOrderId): the customer is always handed this one
// permanent URL, for a quote's pre-invoice deposit just as well as an
// invoice's balance, and it never changes no matter how many times this
// amount is updated.
//
// Body is optional. { amount } lets the admin type a custom deposit figure;
// omitted, the default is the record's full current total for an invoice,
// or this quote's payment-terms deposit (QuoteInput.depositPercent, 100% —
// "pay in full" — when unset) for a quote. Call again any time to change
// what the pay page pre-fills (e.g. after the quote's total changed, or to
// switch from "deposit now" to "collect the remainder later").
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const { record: updated, persisted } = await setSuggestedPaymentAmount(id, { amount, kind });
  if (!updated) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, record: updated, persisted });
}
