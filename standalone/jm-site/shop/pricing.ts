// Cart pricing shared by the shop UI (this site) and the checkout endpoint
// (hat-order-site app/api/shop/checkout imports this same file), so the total
// shown in the cart is computed exactly the way the charge is. Everything is
// in whole cents to avoid floating-point drift.
import catalog from "./catalog.json";

export type Product = (typeof catalog.products)[number];
export type Fulfillment = "ship" | "pickup";
export type CartItem = { slug: string; qty: number };

export const shop = catalog;

export const activeProducts = (): Product[] => catalog.products.filter((p) => p.active);

export const findProduct = (slug: string): Product | undefined =>
  catalog.products.find((p) => p.slug === slug && p.active);

export const toCents = (dollars: number) => Math.round(dollars * 100);

export const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: catalog.currency });

export type PricedCart = {
  lines: { product: Product; qty: number; unitCents: number; lineCents: number }[];
  itemCount: number;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

/** Drops unknown/inactive products and clamps quantities to 1..maxPerItem. */
export function cleanCart(items: CartItem[]): CartItem[] {
  const out = new Map<string, number>();
  for (const it of items ?? []) {
    if (!it || typeof it.slug !== "string" || !findProduct(it.slug)) continue;
    const q = Math.floor(Number(it.qty));
    if (!Number.isFinite(q) || q < 1) continue;
    out.set(it.slug, Math.min(catalog.maxPerItem, (out.get(it.slug) ?? 0) + q));
  }
  return [...out].map(([slug, qty]) => ({ slug, qty }));
}

export function shippingCents(itemCount: number, fulfillment: Fulfillment): number {
  if (fulfillment === "pickup" || itemCount === 0) return 0;
  return toCents(catalog.shipping.firstItem) + toCents(catalog.shipping.eachAdditional) * (itemCount - 1);
}

/** Texas taxes shipping on taxable goods, so tax is on items + shipping. */
export function priceCart(items: CartItem[], fulfillment: Fulfillment): PricedCart {
  const lines = cleanCart(items).map(({ slug, qty }) => {
    const product = findProduct(slug)!;
    const unitCents = toCents(product.price);
    return { product, qty, unitCents, lineCents: unitCents * qty };
  });
  const itemCount = lines.reduce((n, l) => n + l.qty, 0);
  const subtotalCents = lines.reduce((n, l) => n + l.lineCents, 0);
  const ship = shippingCents(itemCount, fulfillment);
  const taxCents = Math.round(((subtotalCents + ship) * catalog.taxRatePercent) / 100);
  return { lines, itemCount, subtotalCents, shippingCents: ship, taxCents, totalCents: subtotalCents + ship + taxCents };
}
