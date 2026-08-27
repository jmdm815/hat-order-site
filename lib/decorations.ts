import { DecorationOption } from "./types";

// Pricing tiers are illustrative placeholders modeled loosely on the
// quantity-bracket approach used by order.hatstitch.com (price per unit
// drops as quantity climbs; a flat setup fee is waived at higher tiers
// by returning 0 in getSetupFee below).
//
// Placement zones are NOT defined here anymore — they're fully configurable
// per catalog item per decoration type by the admin (see lib/item-config-store.ts
// and CatalogItemConfig in lib/types.ts). This list only carries the
// pricing/label/file-type shape shared across every item that offers a
// given decoration type.
export const DECORATION_OPTIONS: DecorationOption[] = [
  {
    id: "uv-patch",
    label: "UV Patch",
    shortLabel: "UV Patch",
    description:
      "Full-color logos printed on a durable patch. Textured option available for a premium feel.",
    minQuantity: 12,
    setupFee: 35,
    pricingTiers: [
      { minQty: 12, pricePerUnit: 6.5 },
      { minQty: 24, pricePerUnit: 5.75 },
      { minQty: 48, pricePerUnit: 5.0 },
      { minQty: 96, pricePerUnit: 4.25 },
      { minQty: 144, pricePerUnit: 3.75 },
    ],
    turnaroundDays: "10-12 business days",
    acceptedFileTypes: [".png", ".jpg", ".pdf", ".ai", ".svg"],
  },
  {
    id: "engraved-patch",
    label: "Engraved (Laser) Patch",
    shortLabel: "Engraved Patch",
    description:
      "The classic patch. Laser-etched leatherette for a clean, single-tone look.",
    minQuantity: 12,
    setupFee: 30,
    pricingTiers: [
      { minQty: 12, pricePerUnit: 5.75 },
      { minQty: 24, pricePerUnit: 5.0 },
      { minQty: 48, pricePerUnit: 4.4 },
      { minQty: 96, pricePerUnit: 3.75 },
      { minQty: 144, pricePerUnit: 3.25 },
    ],
    turnaroundDays: "8-10 business days",
    acceptedFileTypes: [".png", ".jpg", ".pdf", ".ai", ".svg"],
  },
  {
    id: "embroidered",
    label: "Embroidered Design / Patch",
    shortLabel: "Embroidered",
    description: "Classic stitched logo, flat or with 3D puff.",
    minQuantity: 12,
    setupFee: 45,
    pricingTiers: [
      { minQty: 12, pricePerUnit: 7.0 },
      { minQty: 24, pricePerUnit: 6.25 },
      { minQty: 48, pricePerUnit: 5.5 },
      { minQty: 96, pricePerUnit: 4.75 },
      { minQty: 144, pricePerUnit: 4.1 },
    ],
    turnaroundDays: "10-14 business days",
    acceptedFileTypes: [".png", ".jpg", ".pdf", ".ai", ".dst"],
  },
  {
    id: "screen-print",
    label: "Screen Print",
    shortLabel: "Screen Print",
    description:
      "Durable ink printed directly onto the garment. Best for bold single- or multi-color designs at higher quantities.",
    minQuantity: 12,
    setupFee: 25,
    pricingTiers: [
      { minQty: 12, pricePerUnit: 4.5 },
      { minQty: 24, pricePerUnit: 3.75 },
      { minQty: 48, pricePerUnit: 3.0 },
      { minQty: 96, pricePerUnit: 2.5 },
      { minQty: 144, pricePerUnit: 2.0 },
    ],
    turnaroundDays: "7-10 business days",
    acceptedFileTypes: [".png", ".jpg", ".pdf", ".ai", ".svg"],
  },
];

export function getDecoration(id: string): DecorationOption | undefined {
  return DECORATION_OPTIONS.find((d) => d.id === id);
}

export function getUnitPriceForQuantity(
  decoration: DecorationOption,
  quantity: number
): number {
  const applicable = [...decoration.pricingTiers]
    .sort((a, b) => a.minQty - b.minQty)
    .filter((t) => quantity >= t.minQty);
  return applicable.length
    ? applicable[applicable.length - 1].pricePerUnit
    : decoration.pricingTiers[0].pricePerUnit;
}

// Setup/digitization fee is waived at 48+ units, and waived entirely if the
// customer tells us they've ordered with this same logo before (mirrors the
// "have you ordered with us before" question on the reference site).
export function getSetupFee(
  decoration: DecorationOption,
  quantity: number,
  sameLogoBefore: boolean
): number {
  if (sameLogoBefore) return 0;
  if (quantity >= 48) return 0;
  return decoration.setupFee;
}
