import { GarmentMarkupBreakpoint, Product } from "./types";

// Finds the markup percentage for a given blank-garment vendor cost by
// matching it against the admin-configured breakpoint matrix (see
// lib/garment-markup-store.ts). Breakpoints are checked in the order given;
// a cost is "in" a breakpoint when from <= cost <= to. If no breakpoint
// matches (e.g. the table doesn't cover this cost, or is empty), no markup
// is applied — this keeps a misconfigured/blank table a safe no-op rather
// than silently zeroing out or inflating garment prices.
export function getMarkupPercentForCost(
  breakpoints: GarmentMarkupBreakpoint[],
  cost: number
): number {
  const match = breakpoints.find((bp) => cost >= bp.from && cost <= bp.to);
  return match ? match.markupPercent : 0;
}

// Applies that markup to a raw vendor cost, rounded the same way the rest of
// the quote engine rounds money (2 decimals).
export function applyGarmentMarkup(cost: number, breakpoints: GarmentMarkupBreakpoint[]): number {
  const percent = getMarkupPercentForCost(breakpoints, cost);
  return Math.round(cost * (1 + percent / 100) * 100) / 100;
}

// Marks up every price on a customer-facing Product — basePrice and every
// size's price across every color — from raw vendor/blank cost to the
// admin's real sell price, using the same breakpoint matrix as the admin
// quote builder (lib/quote.ts). Historically the customer-facing catalog,
// designer, cart, and quote tools priced garments straight from SanMar cost
// with no markup layer at all (only the decoration fee carried margin) —
// this brings every customer-facing surface in line with the admin quote
// builder, which already applied this markup. Only ever call this on
// SanMar-sourced products (raw vendor cost); a custom/admin-added product's
// prices are already the intended sell price and must not be marked up
// again — callers are expected to skip custom products themselves (see
// app/api/products/[styleNumber]/route.ts, app/api/catalog/route.ts,
// lib/curated-catalog.ts for the pattern).
export function applyGarmentMarkupToProduct(
  product: Product,
  breakpoints: GarmentMarkupBreakpoint[]
): Product {
  const markedColors = product.colors.map((c) => ({
    ...c,
    sizes: c.sizes?.map((s) => ({ ...s, price: applyGarmentMarkup(s.price, breakpoints) })),
  }));
  const cheapest = markedColors.reduce((min, c) => {
    for (const s of c.sizes ?? []) {
      if (s.price > 0 && s.price < min) min = s.price;
    }
    return min;
  }, Infinity);
  return {
    ...product,
    colors: markedColors,
    basePrice: Number.isFinite(cheapest)
      ? cheapest
      : applyGarmentMarkup(product.basePrice, breakpoints),
  };
}
