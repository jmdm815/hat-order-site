import { NextRequest, NextResponse } from "next/server";
import { WebhooksHelper } from "square";
import { isSquareWebhookConfigured } from "@/lib/square-client";
import { findQuoteBySquareOrderId, markInvoicePaidFromSquare } from "@/lib/quotes-store";

export const runtime = "nodejs";

// Public endpoint Square calls when a payment-link order's payment status
// changes. Registered manually in the Square Developer Dashboard (Webhooks)
// against this route's full URL — that's a one-time setup step only the
// account owner can do there, this route just has to be ready for it. Every
// request is signature-verified against SQUARE_WEBHOOK_SIGNATURE_KEY before
// any of its contents are trusted; with that env var unset, this route
// refuses everything (501) rather than ever processing an unsigned payload,
// so invoices keep working in fully-manual "admin clicks Mark paid" mode
// until the owner finishes that setup.
export async function POST(req: NextRequest) {
  if (!isSquareWebhookConfigured()) {
    return NextResponse.json(
      { error: "Square webhook signature key not configured" },
      { status: 501 }
    );
  }

  const signatureHeader = req.headers.get("x-square-hmacsha256-signature");
  const rawBody = await req.text();

  if (!signatureHeader) {
    return NextResponse.json({ error: "Missing signature header" }, { status: 400 });
  }

  let valid = false;
  try {
    valid = await WebhooksHelper.verifySignature({
      requestBody: rawBody,
      signatureHeader,
      signatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "",
      notificationUrl: req.url,
    });
  } catch (err) {
    console.error("POST /api/webhooks/square: signature verification error", err);
    return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
  }

  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody) as {
    type?: string;
    data?: { object?: { payment?: { id?: string; order_id?: string; status?: string } } };
  };

  try {
    if (event.type === "payment.updated") {
      const payment = event.data?.object?.payment;
      if (payment?.status === "COMPLETED" && payment.order_id && payment.id) {
        const quote = await findQuoteBySquareOrderId(payment.order_id);
        if (quote) {
          await markInvoicePaidFromSquare(quote.id, payment.id);
        } else {
          // Not every Square order on this account is necessarily one of our
          // invoices (e.g. in-person Storefront sales) — nothing to do.
          console.warn(`Square webhook: no invoice found for order ${payment.order_id}`);
        }
      }
    }
  } catch (err) {
    console.error("POST /api/webhooks/square: handler error", err);
    // Still acknowledge receipt (200) so Square doesn't endlessly retry a
    // payload we understood but failed to apply; the error is logged above
    // for follow-up, and the admin can always fall back to "Mark paid".
  }

  return NextResponse.json({ ok: true });
}
