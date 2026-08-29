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
