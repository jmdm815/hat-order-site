import { randomUUID } from "crypto";
import type { OrderLineItem } from "square";
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
// invoice at all.
//
// Built as a full itemized Order (one line item per quote line, plus one per
// setup charge) rather than Square's single-amount "Quick Pay" shape, so the
// customer sees roughly the same breakdown on Square's checkout page that
// they got on the invoice PDF — not just one lump total. Each line item's
// quantity is kept at "1" and its basePriceMoney is set to that LINE'S full
// total (not a per-unit price): the unit count is folded into the item's
// name instead (e.g. "24 × Port & Co. Tee — Navy · Screen Print"). This is
// deliberate, not a shortcut — per-unit prices can include per-size garment
// upcharges that don't divide evenly into a single whole-cent unit price, so
// multiplying a rounded per-unit price back out by quantity could land a
// cent or two off the invoice's actual total. Using the line's exact total
// as a quantity-of-1 "item" means the sum of line items always equals
// record.computed.grandTotal exactly, with no rounding reconciliation needed.
// ---------------------------------------------------------------------------

export class SquareNotConfiguredError extends Error {
  constructor() {
    super("Square is not configured (missing SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID)");
    this.name = "SquareNotConfiguredError";
  }
}

function cents(amount: number): bigint {
  return BigInt(Math.round(amount * 100));
}

function buildLineItems(record: QuoteRecord): OrderLineItem[] {
  const items: OrderLineItem[] = [];

  for (const line of record.computed.lines) {
    if (line.quantity <= 0) continue;
    const garmentLabel = line.customerSupplied
      ? line.itemDescription || "Customer-supplied item"
      : [line.brandName, line.productName].filter(Boolean).join(" ") +
        (line.colorName ? ` — ${line.colorName}` : "");
    const decoLabel = line.decorationLabel
      ? ` · ${line.decorationLabel}${line.priceColumnLabel ? ` (${line.priceColumnLabel})` : ""}`
      : "";
    items.push({
      name: `${line.quantity} × ${garmentLabel}${decoLabel}`.slice(0, 500),
      quantity: "1",
      basePriceMoney: { amount: cents(line.subtotal), currency: "USD" },
    });
  }

  for (const charge of record.computed.setupCharges) {
    items.push({
      name: charge.label.slice(0, 500),
      quantity: "1",
      basePriceMoney: { amount: cents(charge.price), currency: "USD" },
    });
  }

  return items;
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

  const name = record.invoiceNumber
    ? `Invoice ${record.invoiceNumber}`
    : `Order for ${record.computed.customerName || "customer"}`;

  const lineItems = buildLineItems(record);

  const response = await client.checkout.paymentLinks.create(
    lineItems.length > 0
      ? {
          idempotencyKey: randomUUID(),
          description: name,
          order: {
            locationId,
            referenceId: record.id,
            lineItems,
          },
          checkoutOptions: {
            askForShippingAddress: false,
          },
          paymentNote: record.id,
        }
      : {
          // Fallback for the (unexpected) case of an invoice with no
          // priceable lines at all — a single lump-sum item is still better
          // than failing to create a link outright.
          idempotencyKey: randomUUID(),
          description: name,
          quickPay: {
            name,
            priceMoney: { amount: cents(record.computed.grandTotal), currency: "USD" },
            locationId,
          },
          checkoutOptions: {
            askForShippingAddress: false,
          },
          paymentNote: record.id,
        }
  );

  const link = response.paymentLink;
  if (!link?.url || !link.id) {
    throw new Error("Square did not return a payment link URL");
  }

  return { url: link.url, paymentLinkId: link.id, orderId: link.orderId ?? undefined };
}
