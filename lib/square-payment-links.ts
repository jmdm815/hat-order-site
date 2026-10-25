import { randomUUID } from "crypto";
import type { OrderLineItem, OrderLineItemDiscount } from "square";
import { OrderLineItemDiscountScope, OrderLineItemDiscountType } from "square";
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
//
// A record has exactly ONE payment link/order for its whole life, no matter
// how many times its amount is requested as a deposit, a remaining balance,
// or the full total. Asking for a deposit never spins up a second, smaller
// order with just a "Deposit" line on it — it's the SAME full itemized
// order every time, with an ORDER-scoped discount (see depositDiscount)
// knocking the amount due today down to whatever was requested. The
// customer always sees the real order; the discount line just tells them
// how much of it is being held back for later. refreshOrCreatePaymentLink
// below is what makes this possible: it edits that one order (and keeps its
// one URL) in place rather than minting a new link each time.
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

// The real itemized order (same thing a full "Pay online" link uses) — or,
// for a brand-new quote with nothing added to it yet, a single lump-sum
// line for its current total, so there's still something for a deposit
// discount (below) to apply against. There is only ever ONE kind of order
// for a record: a deposit link is never a separate, smaller order — it's
// this same full order with a discount knocked off the amount due today
// (see depositDiscount). That's what keeps a record down to a single
// paymentLinkUrl/squareOrderId no matter how many times the admin asks for
// a different deposit amount, a different balance, or the full total.
function buildFullOrderLineItems(record: QuoteRecord): OrderLineItem[] {
  const items = buildLineItems(record);
  if (items.length > 0) return items;
  const label = record.invoiceNumber
    ? `Invoice ${record.invoiceNumber}`
    : record.quoteNumber
      ? `Quote ${record.quoteNumber}`
      : `Order for ${record.computed.customerName || "customer"}`;
  return [
    { name: label.slice(0, 500), quantity: "1", basePriceMoney: { amount: cents(record.computed.grandTotal), currency: "USD" } },
  ];
}

function lineItemsTotalCents(items: OrderLineItem[]): bigint {
  return items.reduce((sum, item) => sum + (item.basePriceMoney?.amount ?? BigInt(0)), BigInt(0));
}

// An ORDER-scoped discount that brings the full order's total down to
// whatever amount was actually requested (a deposit, a remaining balance,
// or the full total) — see buildFullOrderLineItems' comment on why the
// order itself never shrinks to just a "Deposit" line. Computed against the
// line items' own cent total (not record.computed.grandTotal) so the
// customer is charged exactly the requested amount even if the order's
// itemization and the quote's grand total were ever to drift apart (e.g.
// tax/misc fees that aren't broken out as their own Square line items
// today). Returns [] — explicitly clearing any discount from a previous,
// smaller request — once the requested amount covers the whole order.
function depositDiscount(itemsTotalCents: bigint, amount: number): OrderLineItemDiscount[] {
  const heldBackCents = itemsTotalCents - cents(amount);
  if (heldBackCents <= BigInt(0)) return [];
  return [
    {
      uid: "deposit-balance",
      name: "Balance due later",
      type: OrderLineItemDiscountType.FixedAmount,
      amountMoney: { amount: heldBackCents, currency: "USD" },
      scope: OrderLineItemDiscountScope.Order,
    },
  ];
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

  const lineItems = buildFullOrderLineItems(record);
  const discounts = depositDiscount(lineItemsTotalCents(lineItems), amount);

  const response = await client.checkout.paymentLinks.create({
    idempotencyKey: randomUUID(),
    description: name,
    order: {
      locationId,
      referenceId: record.id,
      lineItems,
      discounts,
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
        const lineItems = buildFullOrderLineItems(record);
        await client.orders.update({
          orderId: record.squareOrderId,
          order: {
            locationId,
            version: order.version,
            lineItems,
            // Always sent, even as [] — a fully-replace field, not a merge,
            // so paying off the balance (amount === the full order) clears
            // out a previous deposit's "Balance due later" line instead of
            // leaving it stuck on the order.
            discounts: depositDiscount(lineItemsTotalCents(lineItems), amount),
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
