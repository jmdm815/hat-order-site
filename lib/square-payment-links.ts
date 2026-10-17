import { randomUUID } from "crypto";
import { getSquareClient, getSquareLocationId, isSquareConfigured } from "./square-client";
import { QuoteRecord } from "./quotes-store";

// ---------------------------------------------------------------------------
// Square "Pay online" payment links for admin invoices.
// ---------------------------------------------------------------------------
// Separate from app/api/checkout/route.ts's card/Afterpay flow, which charges
// a sourceId collected by Square's Web Payments SDK right there on this
// site's own checkout page. This is the opposite shape: we hand the customer
// a Square-hosted checkout URL (via the Checkout API's "Payment Links"
// feature) and Square collects the card/Afterpay/Cash App Pay details on
// its own page, so there's no PCI surface on this site for an admin-created
// invoice at all. Uses Square's "Quick Pay" shape (one ad-hoc line item: the
// invoice's total, by name) rather than building a full itemized Order —
// simpler, and the per-line breakdown the customer needs is already on the
// invoice PDF they received.
// ---------------------------------------------------------------------------

export class SquareNotConfiguredError extends Error {
  constructor() {
    super("Square is not configured (missing SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID)");
    this.name = "SquareNotConfiguredError";
  }
}

export async function createInvoicePaymentLink(
  record: QuoteRecord
): Promise<{ url: string; paymentLinkId: string; orderId?: string }> {
  if (!isSquareConfigured()) throw new SquareNotConfiguredError();
  if (record.status !== "invoice") {
    throw new Error("Payment links can only be created for invoices, not quotes");
  }

  const client = getSquareClient();
  const locationId = getSquareLocationId();
  const total = record.computed.grandTotal;
  const amount = BigInt(Math.round(total * 100));

  const name = record.invoiceNumber
    ? `Invoice ${record.invoiceNumber}`
    : `Order for ${record.computed.customerName || "customer"}`;

  const response = await client.checkout.paymentLinks.create({
    idempotencyKey: randomUUID(),
    description: name,
    quickPay: {
      name,
      priceMoney: { amount, currency: "USD" },
      locationId,
    },
    checkoutOptions: {
      askForShippingAddress: false,
    },
    paymentNote: record.id,
  });

  const link = response.paymentLink;
  if (!link?.url || !link.id) {
    throw new Error("Square did not return a payment link URL");
  }

  return { url: link.url, paymentLinkId: link.id, orderId: link.orderId ?? undefined };
}
