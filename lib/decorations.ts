import { DecorationOption } from "./types";

// The list of decoration types (UV Patch, Embroidered, ...) used to be a
// fixed constant exported from here. It's now a fully admin-editable,
// persisted entity — see lib/decoration-types-store.ts for the CRUD store
// and its built-in seed data. This file only keeps the pure pricing math,
// which doesn't care where the DecorationOption it's given came from.

export function getDecoration(
  decorations: DecorationOption[],
  id: string
): DecorationOption | undefined {
  return decorations.find((d) => d.id === id);
}

// `columnId` selects a price from that tier's pricesByColumn (e.g. an
// embroidery stitch-count band) when the decoration type has priceColumns
// configured. If the tier has no entry for that column — or the decoration
// has no columns at all, or no columnId is passed — this falls back to the
// tier's plain pricePerUnit, so callers that don't know about columns keep
// working exactly as before.
export function getUnitPriceForQuantity(
  decoration: DecorationOption,
  quantity: number,
  columnId?: string
): number {
  const applicable = [...decoration.pricingTiers]
    .sort((a, b) => a.minQty - b.minQty)
    .filter((t) => quantity >= t.minQty);
  const tier = applicable.length
    ? applicable[applicable.length - 1]
    : decoration.pricingTiers[0];
  if (columnId && tier.pricesByColumn && tier.pricesByColumn[columnId] !== undefined) {
    return tier.pricesByColumn[columnId];
  }
  return tier.pricePerUnit;
}

// Setup/digitization fee is waived at 48+ units, and waived entirely if the
// customer tells us they've ordered with this same logo before (mirrors the
// "have you ordered with us before" question on the reference site). It can
// also be switched off altogether per decoration type from the admin
// Pricing tab (setupFeeEnabled) — checked first since that's an
// unconditional admin override, not a quantity/repeat-order discount.
export function getSetupFee(
  decoration: DecorationOption,
  quantity: number,
  sameLogoBefore: boolean
): number {
  if (decoration.setupFeeEnabled === false) return 0;
  if (sameLogoBefore) return 0;
  if (quantity >= 48) return 0;
  return decoration.setupFee;
}
