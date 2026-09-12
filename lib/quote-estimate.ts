import { DecorationOption } from "./types";
import { getUnitPriceForQuantity, getSetupFee } from "./decorations";

// Pure pricing math for the customer-facing "Get Quote" instant estimator
// (components/QuoteEstimator.tsx) — a lighter-weight sibling to the full
// /customize designer flow that skips artwork upload/placement entirely so
// a shopper can see a real ballpark price for a quantity + decoration type
// combo in one step. Reuses the same per-unit/setup-fee math as the real
// cart (lib/decorations.ts) so the number shown here is consistent with
// what they'd actually be charged if they go on to place the order.
export type EstimateInput = {
  garmentTotal: number; // sum of quantity * that size/color's unit price
  quantity: number; // total units across all sizes
  decoration?: DecorationOption;
  columnId?: string;
  sameLogoBefore?: boolean;
};

export type Estimate = {
  garmentTotal: number;
  decorationUnitPrice: number;
  decorationTotal: number;
  setupFee: number;
  total: number;
  // True when the chosen decoration type has no automatic pricing
  // (DecorationOption.quoteRequired) — decorationTotal/setupFee are 0 and
  // the UI should say pricing needs a follow-up instead of showing $0.
  quoteRequired: boolean;
};

export function computeEstimate(input: EstimateInput): Estimate {
  const { garmentTotal, quantity, decoration, columnId, sameLogoBefore } = input;

  if (!decoration || quantity <= 0) {
    return {
      garmentTotal,
      decorationUnitPrice: 0,
      decorationTotal: 0,
      setupFee: 0,
      total: garmentTotal,
      quoteRequired: false,
    };
  }

  if (decoration.quoteRequired) {
    return {
      garmentTotal,
      decorationUnitPrice: 0,
      decorationTotal: 0,
      setupFee: 0,
      total: garmentTotal,
      quoteRequired: true,
    };
  }

  const decorationUnitPrice = getUnitPriceForQuantity(decoration, quantity, columnId);
  const decorationTotal = decorationUnitPrice * quantity;
  const setupFee = getSetupFee(decoration, quantity, Boolean(sameLogoBefore));

  return {
    garmentTotal,
    decorationUnitPrice,
    decorationTotal,
    setupFee,
    total: garmentTotal + decorationTotal + setupFee,
    quoteRequired: false,
  };
}
