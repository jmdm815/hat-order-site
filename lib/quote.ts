// ---------------------------------------------------------------------------
// Admin quote builder — pure computation logic (no React, no fetch).
// Turns a list of "garment + sizes/qty + decoration" line inputs into fully
// priced quote lines plus a total, using the exact same live SanMar pricing
// and admin-editable decoration pricing (lib/decorations.ts /
// lib/decoration-types-store.ts) the customer-facing site uses — so a quote
// generated here always matches what the site would actually charge.
// ---------------------------------------------------------------------------

import { getUnitPriceForQuantity } from "./decorations";
import { applyGarmentMarkup } from "./garment-markup";
import { DecorationOption, GarmentMarkupBreakpoint, Product, SetupChargeType } from "./types";

// Rounds to the nearest cent and strips binary-float noise (e.g.
// 19.810000000000002) so every price in the computed quote — and therefore
// every price shown in the UI and printed on the PDF — is a clean 2-decimal
// dollar amount.
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

export type QuoteSizeInput = { size: string; quantity: number };

// One row the admin builds in the UI: a specific style + color, a set of
// sizes/quantities, and the decoration applied to all of them.
export type QuoteLineInput = {
  styleNumber: string;
  colorName: string;
  sizes: QuoteSizeInput[]; // quantity 0 entries are dropped before computing
  decorationId?: string; // absent/"" = no decoration, garment only
  priceColumnId?: string; // e.g. a stitch-count band, when the decoration has priceColumns
};

export type QuoteInput = {
  customerName?: string;
  customerCompany?: string;
  customerEmail?: string;
  quoteDate?: string; // ISO date; defaults to today if absent
  notes?: string;
  lines: QuoteLineInput[];
  // Ids of named, flat setup/digitization charges (see
  // lib/setup-charges-store.ts) to attach to this quote as a whole. These
  // are independent of any line's decoration — a quote can combine any of
  // them (e.g. "Digitizing for embroidery" + "Logo vectorization").
  setupChargeIds?: string[];
};

export type QuoteSizeResult = {
  size: string;
  quantity: number;
  garmentUnitPrice: number;
  decorationUnitPrice: number;
  unitPrice: number; // garment + decoration
  lineTotal: number; // unitPrice * quantity
};

export type QuoteLineResult = {
  styleNumber: string;
  brandName: string;
  productName: string;
  colorName: string;
  decorationId?: string;
  decorationLabel?: string;
  priceColumnId?: string;
  priceColumnLabel?: string;
  sizes: QuoteSizeResult[];
  quantity: number; // sum of this line's size quantities
  subtotal: number; // sum of sizes[].lineTotal
};

// A quote-level setup/digitization charge resolved from lib/setup-charges-store.ts.
export type QuoteSetupCharge = { id: string; label: string; price: number };

export type ComputedQuote = {
  customerName?: string;
  customerCompany?: string;
  customerEmail?: string;
  quoteDate: string;
  notes?: string;
  lines: QuoteLineResult[];
  setupCharges: QuoteSetupCharge[]; // itemized, quote-wide (not tied to any decoration)
  totalQuantity: number;
  totalSetupFees: number; // sum of setupCharges[].price
  totalGarmentAndDecoration: number; // sum of all lines' garment + decoration cost, no setup
  grandTotal: number; // totalGarmentAndDecoration + totalSetupFees
};

// Error thrown for a line whose styleNumber/colorName/size doesn't resolve
// against the live catalog, so the API route can return a clear 400 instead
// of a generic 500.
export class QuoteInputError extends Error {}

// Shared request-shape validator used by every route that accepts a
// QuoteInput body (/api/admin/quote, /api/admin/quote/pdf,
// /api/admin/quotes, /api/admin/quotes/[id]) — kept in one place so they
// can't drift out of sync with each other or with the QuoteInput type.
export function isValidQuoteInput(body: unknown): body is QuoteInput {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.lines) || b.lines.length === 0) return false;
  if (b.setupChargeIds !== undefined) {
    if (!Array.isArray(b.setupChargeIds) || !b.setupChargeIds.every((id) => typeof id === "string")) {
      return false;
    }
  }
  return b.lines.every((line) => {
    if (typeof line !== "object" || line === null) return false;
    const l = line as Record<string, unknown>;
    if (typeof l.styleNumber !== "string" || typeof l.colorName !== "string") return false;
    if (!Array.isArray(l.sizes)) return false;
    return l.sizes.every(
      (s) =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Record<string, unknown>).size === "string" &&
        typeof (s as Record<string, unknown>).quantity === "number"
    );
  });
}

export function findProductColor(product: Product, colorName: string) {
  const color = product.colors.find((c) => c.colorName === colorName);
  if (!color) {
    throw new QuoteInputError(
      `Style ${product.styleNumber} has no color "${colorName}"`
    );
  }
  return color;
}

// Groups quote lines by (decorationId + priceColumnId) so the quantity
// price-break tier and the one-time setup fee are computed against the
// *combined* quantity across every line sharing that same decoration +
// pricing column — e.g. 7 units of one style and 6 of another, both
// embroidered at the same stitch-count band, share one 13-unit tier rather
// than each falling back to the "1 unit" tier on its own.
function groupKey(decorationId?: string, priceColumnId?: string): string {
  return `${decorationId ?? ""}::${priceColumnId ?? ""}`;
}

export function computeQuote(
  input: QuoteInput,
  productsByStyle: Map<string, Product>,
  decorations: DecorationOption[],
  setupChargeCatalog: SetupChargeType[] = [],
  garmentMarkupBreakpoints: GarmentMarkupBreakpoint[] = []
): ComputedQuote {
  const cleanedLines = input.lines
    .map((line) => ({ ...line, sizes: line.sizes.filter((s) => s.quantity > 0) }))
    .filter((line) => line.sizes.length > 0);

  if (cleanedLines.length === 0) {
    throw new QuoteInputError("A quote needs at least one line with a quantity greater than 0.");
  }

  // Setup/digitization charges are picked directly for the quote as a whole
  // (e.g. "Digitizing for embroidery", "Logo vectorization") — they are NOT
  // derived from any line's decoration type, so resolve them once against
  // the admin-editable catalog (lib/setup-charges-store.ts).
  const setupCharges: QuoteSetupCharge[] = (input.setupChargeIds ?? []).map((id) => {
    const match = setupChargeCatalog.find((c) => c.id === id);
    if (!match) {
      throw new QuoteInputError(`Unknown setup charge "${id}"`);
    }
    return { id: match.id, label: match.label, price: money(match.price) };
  });

  // Pass 1: resolve garment prices and combined quantity per decoration group.
  const groupQuantity = new Map<string, number>();
  for (const line of cleanedLines) {
    const qty = line.sizes.reduce((sum, s) => sum + s.quantity, 0);
    const key = groupKey(line.decorationId, line.priceColumnId);
    groupQuantity.set(key, (groupQuantity.get(key) ?? 0) + qty);
  }

  const lines: QuoteLineResult[] = cleanedLines.map((line) => {
    const product = productsByStyle.get(line.styleNumber);
    if (!product) {
      throw new QuoteInputError(`Unknown style number "${line.styleNumber}"`);
    }
    const color = findProductColor(product, line.colorName);
    const decoration = line.decorationId
      ? decorations.find((d) => d.id === line.decorationId)
      : undefined;
    if (line.decorationId && !decoration) {
      throw new QuoteInputError(`Unknown decoration type "${line.decorationId}"`);
    }

    const key = groupKey(line.decorationId, line.priceColumnId);
    const groupQty = groupQuantity.get(key) ?? 0;
    const decorationUnitPrice = decoration
      ? decoration.quoteRequired
        ? 0
        : getUnitPriceForQuantity(decoration, groupQty, line.priceColumnId)
      : 0;

    const sizes: QuoteSizeResult[] = line.sizes.map((s) => {
      const sizeInfo = color.sizes?.find((sz) => sz.name === s.size);
      const garmentCost = sizeInfo?.price ?? product.basePrice;
      const garmentUnitPrice = money(applyGarmentMarkup(garmentCost, garmentMarkupBreakpoints));
      const roundedDecorationUnitPrice = money(decorationUnitPrice);
      const unitPrice = money(garmentUnitPrice + roundedDecorationUnitPrice);
      return {
        size: s.size,
        quantity: s.quantity,
        garmentUnitPrice,
        decorationUnitPrice: roundedDecorationUnitPrice,
        unitPrice,
        lineTotal: money(unitPrice * s.quantity),
      };
    });

    const priceColumnLabel = line.priceColumnId
      ? decoration?.priceColumns?.find((c) => c.id === line.priceColumnId)?.label
      : undefined;

    const quantity = sizes.reduce((sum, s) => sum + s.quantity, 0);
    const subtotal = money(sizes.reduce((sum, s) => sum + s.lineTotal, 0));

    return {
      styleNumber: product.styleNumber,
      brandName: product.brandName,
      productName: product.productName,
      colorName: color.colorName,
      decorationId: line.decorationId,
      decorationLabel: decoration?.label,
      priceColumnId: line.priceColumnId,
      priceColumnLabel,
      sizes,
      quantity,
      subtotal,
    };
  });

  const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0);
  const totalSetupFees = money(setupCharges.reduce((sum, c) => sum + c.price, 0));
  const totalGarmentAndDecoration = money(
    lines.reduce((sum, l) => sum + l.sizes.reduce((s, sz) => s + sz.lineTotal, 0), 0)
  );
  const grandTotal = money(totalGarmentAndDecoration + totalSetupFees);

  return {
    customerName: input.customerName,
    customerCompany: input.customerCompany,
    customerEmail: input.customerEmail,
    quoteDate: input.quoteDate ?? new Date().toISOString().slice(0, 10),
    notes: input.notes,
    lines,
    setupCharges,
    totalQuantity,
    totalSetupFees,
    totalGarmentAndDecoration,
    grandTotal,
  };
}
