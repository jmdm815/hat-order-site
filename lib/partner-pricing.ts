// What a partner (white-label) site is allowed to price: digital print only,
// SanMar/S&S garments or "no garment" (they supply it), plus two add-ons
// (digitizing, vectorizing). Everything is priced at JM Media's own sell
// price — live garment cost + JM's markup table + JM's decoration tiers —
// with no overrides of any kind accepted from the partner.
import type { QuoteInput, QuoteLineInput } from "@/lib/quote";

export const PARTNER_DECORATION_ID = "digital-print";
export const PARTNER_ADDONS: Record<string, string> = {
  digitizing: "digitizing-embroidery",
  vectorizing: "logo-vectorization",
};

export type PartnerLineInput = {
  id?: string;
  garment: "catalog" | "none";
  catalogSource?: "sanmar" | "ss";
  styleNumber?: string;
  colorName?: string;
  description?: string; // "none" garment: what the item is
  locations: number; // 1-4 print locations, 0 = garment only (no print)
  sizes: { size: string; quantity: number }[];
};

export type PartnerPriceRequest = {
  lines: PartnerLineInput[];
  addons?: string[]; // keys of PARTNER_ADDONS
};

export class PartnerInputError extends Error {}

const SIZE_RE = /^[A-Za-z0-9/ .-]{1,16}$/;

export function toQuoteInput(req: unknown): QuoteInput {
  if (!req || typeof req !== "object") throw new PartnerInputError("Invalid request");
  const r = req as PartnerPriceRequest;
  if (!Array.isArray(r.lines) || !r.lines.length) throw new PartnerInputError("Add at least one item");
  if (r.lines.length > 40) throw new PartnerInputError("Too many items");
  const lines: QuoteLineInput[] = r.lines.map((l, i) => {
    const sizes = (Array.isArray(l?.sizes) ? l.sizes : [])
      .map((s) => ({ size: String(s?.size ?? "").trim(), quantity: Math.floor(Number(s?.quantity) || 0) }))
      .filter((s) => s.quantity > 0 && s.quantity <= 100000 && SIZE_RE.test(s.size));
    if (!sizes.length) throw new PartnerInputError(`Item ${i + 1}: enter at least one quantity`);
    const loc = Math.floor(Number(l.locations) || 0);
    if (loc < 0 || loc > 4) throw new PartnerInputError(`Item ${i + 1}: 0-4 print locations`);
    const deco = loc > 0 ? { decorationId: PARTNER_DECORATION_ID, priceColumnId: `loc${loc}` } : {};
    const lineId = typeof l.id === "string" && /^[\w-]{1,64}$/.test(l.id) ? l.id : `p${i}`;
    if (l.garment === "none") {
      const desc = String(l.description ?? "").trim().slice(0, 120) || "Customer-supplied item";
      return {
        lineId,
        customerSupplied: true,
        manualSource: "customer-supplied",
        itemType: "apparel",
        itemDescription: desc,
        sizes: sizes.map((s) => ({ ...s, garmentCost: 0, garmentMarkupPercent: 0 })),
        ...deco,
      } as QuoteLineInput;
    }
    const src = l.catalogSource === "ss" ? "ss" : "sanmar";
    const style = String(l.styleNumber ?? "").trim();
    const color = String(l.colorName ?? "").trim();
    if (!/^[\w.-]{1,32}$/.test(style)) throw new PartnerInputError(`Item ${i + 1}: pick a style`);
    if (!color || color.length > 80) throw new PartnerInputError(`Item ${i + 1}: pick a color`);
    return { lineId, styleNumber: style, catalogSource: src, colorName: color, sizes, ...deco };
  });
  const setupChargeIds = Array.from(new Set((r.addons ?? []).filter((a) => a in PARTNER_ADDONS))).map(
    (a) => PARTNER_ADDONS[a],
  );
  return { lines, setupChargeIds, taxRatePercent: 0 } as QuoteInput;
}
