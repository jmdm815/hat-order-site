import { randomUUID } from "crypto";
import type { OrderLineItem } from "square";
import { getSquareClient, getSquareLocationId, isSquareConfigured } from "./square-client";
import { QuoteRecord } from "./quotes-store";

// What a payment link's current amount is derived from — kept on the record
// (QuoteRecord.paymentLinkKind) so a later edit to the quote/invoice knows
// whether to automatically recompute the link's amount:
//   - "full": always the record's current grandTotal (the invoice case).
//   - "deposit-percent": grandTotal * the quote's payment-terms depositPercent
//     — recomputed automatically if either changes.
//   - "deposit-fixed": a specific dollar amount the admin typed by hand —
//     never silently recalculated, only replaced by creating a new link.
export type PaymentLinkKind = "full" | "deposit-percent" | "deposit-fixed";

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

// A single line item representing a deposit — used whenever the requested
// amount doesn't equal the record's current full total (the common case for
// a quote, paid before conversion to an invoice; also usable on an invoice
// if ever needed). Kept as a proper itemized `order` (not Square's "quick
// pay" shape) specifically so it still has a real orderId afterward and can
// later be updated in place by refreshOrCreatePaymentLink below — quick pay
// links don't expose an editable order the same way.
function buildDepositLineItem(record: QuoteRecord, amount: number): OrderLineItem[] {
  const label = record.invoiceNumber
    ? `Deposit — Invoice ${record.invoiceNumber}`
    : record.quoteNumber
      ? `Deposit — Quote ${record.quoteNumber}`
      : "Deposit";
  return [{ name: label.slice(0, 500), quantity: "1", basePriceMoney: { amount: cents(amount), currency: "USD" } }];
}

function lineItemsForAmount(record: QuoteRecord, amount: number): OrderLineItem[] {
  const isFullTotal = Math.abs(amount - record.computed.grandTotal) < 0.005;
  if (isFullTotal) {
    const full = buildLineItems(record);
    if (full.length > 0) return full;
  }
  return buildDepositLineItem(record, amount);
}

// Creates a brand-new Square payment link (and its backing Order) for the
// given amount. Used for the very first link on a record, and as the
// fallback whenever refreshOrCreatePaymentLink below can't update an
// existing order in place.
async function createPaymentLink(
  record: QuoteRecord,
  amount: number
): Promise<{ url: string; paymentLinkId: string; orderId?: string }> {
  if (!isSquareConfigured()) throw new SquareNotConfiguredError();

  const client = getSquareClient();
  const locationId = getSquareLocationId();

  const name = record.invoiceNumber
    ? `Invoice ${record.invoiceNumber}`
    : record.quoteNumber
      ? `Quote ${record.quoteNumber}`
      : `Order for ${record.computed.customerName || "customer"}`;

  const lineItems = lineItemsForAmount(record, amount);

  const response = await client.checkout.paymentLinks.create({
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
  });

  const link = response.paymentLink;
  if (!link?.url || !link.id) {
    throw new Error("Square did not return a payment link URL");
  }

  return { url: link.url, paymentLinkId: link.id, orderId: link.orderId ?? undefined };
}

// Public entry point for both "create the first link" and "this record
// changed, keep the link's amount in sync" — used by the payment-link admin
// endpoint and by the auto-refresh-on-save logic in
// app/api/admin/quotes/[id]/route.ts. When a Square order already backs the
// record's current link, tries to update that order's line items IN PLACE
// (same orderId, same payment link, same URL) via the Orders API — Square's
// Payment Link itself can't have its order/amount swapped out directly (its
// own update endpoint explicitly excludes order_id/url), but editing the
// Order a link already points at is a documented, supported way to change
// what a customer sees when they open that same link. Falls back to minting
// a brand-new link whenever there's no existing order to update, or the
// update attempt fails for any reason (order already paid/closed, deleted on
// Square's side, etc.) — a fresh link is always better than a dead one.
export async function refreshOrCreatePaymentLink(
  record: QuoteRecord,
  amount: number
): Promise<{ url: string; paymentLinkId: string; orderId?: string; reused: boolean }> {
  if (!isSquareConfigured()) throw new SquareNotConfiguredError();

  if (record.squareOrderId && record.paymentLinkUrl && record.paymentLinkId) {
    try {
      const client = getSquareClient();
      const locationId = getSquareLocationId();
      const { order } = await client.orders.get({ orderId: record.squareOrderId });
      if (order && typeof order.version === "number") {
        await client.orders.update({
          orderId: record.squareOrderId,
          order: {
            locationId,
            version: order.version,
            lineItems: lineItemsForAmount(record, amount),
          },
          idempotencyKey: randomUUID(),
        });
        return {
          url: record.paymentLinkUrl,
          paymentLinkId: record.paymentLinkId,
          orderId: record.squareOrderId,
          reused: true,
        };
      }
    } catch (err) {
      console.error(
        "square-payment-links: couldn't update the existing order in place, creating a new link instead",
        err
      );
    }
  }

  const created = await createPaymentLink(record, amount);
  return { ...created, reused: false };
}
