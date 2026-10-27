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

export type QuoteSizeInput = {
  size: string;
  quantity: number;
  // Manual cost + markup for a customer-supplied line only (see
  // QuoteLineInput.customerSupplied) — there's no catalog/vendor cost to
  // look up for one of these, so the admin types both directly (mirroring
  // the Item Cost / Item Markup (%) / Item Price columns the catalog
  // picker shows) and garmentUnitPrice is derived from them:
  // garmentCost * (1 + garmentMarkupPercent / 100). Both default to 0 when
  // absent, which reproduces the old customer-supplied behavior (no
  // garment charge — only decoration pricing, if any). Ignored for a
  // catalog line, whose garment price always comes from the looked-up
  // product/color + the admin's garment-markup breakpoint table instead.
  garmentCost?: number;
  garmentMarkupPercent?: number;
};

// One row the admin builds in the UI: a specific style + color, a set of
// sizes/quantities, and the decoration applied to all of them.
//
// A line can instead be "customer-supplied" (customerSupplied: true) — the
// customer brought the item(s) in themselves, so there's no catalog garment
// to look up, no vendor cost, and no garment markup; only decoration pricing
// (if any) applies, pooled into the usual quantity price-break groups right
// alongside every other line via groupKey() below. itemDescription (e.g.
// "Hat", "Shirt", "Bag", "Custom item") replaces styleNumber/colorName as
// the line's label in that case, and styleNumber/colorName are omitted.
export type QuoteLineInput = {
  styleNumber?: string;
  colorName?: string;
  sizes: QuoteSizeInput[]; // quantity 0 entries are dropped before computing
  decorationId?: string; // absent/"" = no decoration, garment only
  priceColumnId?: string; // e.g. a stitch-count band, when the decoration has priceColumns
  customerSupplied?: boolean;
  itemDescription?: string; // required when customerSupplied is true
  // Customer-supplied only: which kind of item this is, so the UI/PDF can
  // show the right fields — "apparel" gets a sizes/cost/markup grid (see
  // QuoteSizeInput), "hat" additionally gets a free-text brand/style/color
  // (styleNumber/colorName above double as that brand's style + color; see
  // brandNameInput below for the brand itself), and "other"/undefined is
  // the original free-form description + flat-or-size-breakdown quantity
  // with no garment cost — unchanged default behavior for backward
  // compatibility with lines saved before this field existed.
  itemType?: "apparel" | "hat" | "other";
  // Customer-supplied "hat" line only: the brand typed by the admin (no
  // catalog brand lookup for one of these) — styleNumber/colorName above
  // hold the rest of a hat's identity (style + color) as plain text.
  brandNameInput?: string;
  // Which ad-hoc entry flow created this manual (customerSupplied) line:
  // "customer-supplied" — the customer brought the item in themselves, so
  // the garment is never charged for (garmentCost/garmentMarkupPercent are
  // ignored/forced to 0 regardless of what's on the size rows) and it shows
  // with the generic "Customer-supplied item" label (unless itemType is
  // "hat", which always gets the catalog-style brand/style/color label).
  // "custom" — a shop-priced ad-hoc item (the admin's own one-off garment,
  // not something the customer brought in) — full garmentCost/markup
  // pricing applies and it's labeled just like a real catalog garment
  // everywhere (Items list, Preview, PDF), with no "customer-supplied"
  // wording. Undefined behaves like "customer-supplied" (old saved quotes).
  manualSource?: "customer-supplied" | "custom";
  // Whether this line counts toward the quote's taxable subtotal — defaults
  // to true (taxable) when absent. See QuoteInput.taxRatePercent.
  taxable?: boolean;
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
  // Ad-hoc, one-off charges entered directly on this quote — a rush fee, a
  // shipping surcharge, anything that isn't a garment/decoration line and
  // isn't a reusable, admin-managed Setup Charge (lib/setup-charges-store.ts).
  // Unlike setupChargeIds, these aren't looked up against any catalog — the
  // label and amount are whatever the admin typed for this quote only.
  // `amount` is the per-unit price; `quantity` (default 1) multiplies it —
  // e.g. a $0.35 polymailer x 50 units.
  miscFees?: { label: string; amount: number; quantity?: number; taxable?: boolean }[];
  // Percent (1-100) of the grand total due as a deposit when the order is
  // placed; the remainder is due later (e.g. at pickup). Undefined/100 means
  // "pay in full" — the common case — so this is optional and most quotes
  // never set it. See lib/types.ts's Customer.defaultDepositPercent for the
  // per-customer default this is usually copied from.
  depositPercent?: number;
  // Sales-tax rate (0-100) applied to the taxable portion of this quote —
  // see lib/tax-rates-store.ts for the admin-editable preset list this is
  // usually picked from, and each line/setupChargeIds entry/miscFee's own
  // `taxable` flag for what counts toward the taxable subtotal. Undefined or
  // 0 means no tax.
  taxRatePercent?: number;
};

export type QuoteSizeResult = {
  size: string;
  quantity: number;
  garmentCost: number; // raw vendor cost before the configured garment markup
  garmentMarkupAmount: number;
  garmentUnitPrice: number; // garment selling price after markup
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
  // See QuoteLineInput — when true, this line has no real catalog garment;
  // styleNumber/colorName above are empty placeholders and itemDescription
  // is what should actually be shown for this line.
  customerSupplied?: boolean;
  itemDescription?: string;
  // See QuoteLineInput.itemType.
  itemType?: "apparel" | "hat" | "other";
  // See QuoteLineInput.manualSource.
  manualSource?: "customer-supplied" | "custom";
  // See QuoteLineInput.taxable — resolved to a concrete true/false here
  // (defaults true when the input left it unset).
  taxable: boolean;
};

// A quote-level setup/digitization charge resolved from lib/setup-charges-store.ts.
export type QuoteSetupCharge = { id: string; label: string; price: number; taxable: boolean };

// A quote-level miscellaneous fee — see QuoteInput.miscFees. `amount` is
// the per-unit price; `lineTotal` is amount * quantity, already computed
// for display/PDF/totals so nothing downstream has to redo that math.
export type QuoteMiscFee = {
  label: string;
  amount: number;
  quantity: number;
  lineTotal: number;
  taxable: boolean;
};

export type ComputedQuote = {
  customerName?: string;
  customerCompany?: string;
  customerEmail?: string;
  quoteDate: string;
  notes?: string;
  lines: QuoteLineResult[];
  setupCharges: QuoteSetupCharge[]; // itemized, quote-wide (not tied to any decoration)
  miscFees: QuoteMiscFee[]; // itemized, ad-hoc, quote-wide — see QuoteInput.miscFees
  totalQuantity: number;
  totalSetupFees: number; // sum of setupCharges[].price
  totalMiscFees: number; // sum of miscFees[].lineTotal
  totalGarmentAndDecoration: number; // sum of all lines' garment + decoration cost, no setup
  // Sum of this quote's garment, setup-charge, and misc-fee totals — the
  // amount due before tax. "Grand total" used to mean this; now that meaning
  // has moved to subtotalBeforeTax and grandTotal includes taxAmount.
  subtotalBeforeTax: number;
  taxRatePercent: number; // see QuoteInput.taxRatePercent; 0 when untaxed
  taxableSubtotal: number; // portion of subtotalBeforeTax from taxable: true items only
  taxAmount: number; // money(taxableSubtotal * taxRatePercent / 100)
  grandTotal: number; // subtotalBeforeTax + taxAmount
  depositPercent?: number; // see QuoteInput.depositPercent
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
  // Empty lines are allowed — a brand-new quote is saved right after the
  // "Quote details" step (customer info, payment terms, tax) so it gets a
  // real id/quote number before any items are added, mirroring the
  // reference quoting tool's "Save & add line item" flow. See
  // components/AdminQuoteBuilder.tsx and computeQuote's handling of an
  // empty cleanedLines below.
  if (!Array.isArray(b.lines)) return false;
  if (b.setupChargeIds !== undefined) {
    if (!Array.isArray(b.setupChargeIds) || !b.setupChargeIds.every((id) => typeof id === "string")) {
      return false;
    }
  }
  if (b.depositPercent !== undefined) {
    if (typeof b.depositPercent !== "number" || b.depositPercent <= 0 || b.depositPercent > 100) {
      return false;
    }
  }
  if (b.taxRatePercent !== undefined) {
    if (typeof b.taxRatePercent !== "number" || b.taxRatePercent < 0 || b.taxRatePercent > 100) {
      return false;
    }
  }
  if (b.miscFees !== undefined) {
    if (
      !Array.isArray(b.miscFees) ||
      !b.miscFees.every((f) => {
        if (typeof f !== "object" || f === null) return false;
        const m = f as Record<string, unknown>;
        if (m.taxable !== undefined && typeof m.taxable !== "boolean") return false;
        if (m.quantity !== undefined && (typeof m.quantity !== "number" || m.quantity <= 0)) return false;
        return typeof m.label === "string" && m.label !== "" && typeof m.amount === "number" && m.amount > 0;
      })
    ) {
      return false;
    }
  }
  return b.lines.every((line) => {
    if (typeof line !== "object" || line === null) return false;
    const l = line as Record<string, unknown>;
    if (l.customerSupplied === true) {
      if (typeof l.itemDescription !== "string" || !l.itemDescription.trim()) return false;
      if (l.itemType !== undefined && !["apparel", "hat", "other"].includes(l.itemType as string)) return false;
      if (
        l.manualSource !== undefined &&
        !["customer-supplied", "custom"].includes(l.manualSource as string)
      ) {
        return false;
      }
      if (l.brandNameInput !== undefined && typeof l.brandNameInput !== "string") return false;
      if (l.styleNumber !== undefined && typeof l.styleNumber !== "string") return false;
      if (l.colorName !== undefined && typeof l.colorName !== "string") return false;
    } else if (typeof l.styleNumber !== "string" || typeof l.colorName !== "string") {
      return false;
    }
    if (l.taxable !== undefined && typeof l.taxable !== "boolean") return false;
    if (!Array.isArray(l.sizes)) return false;
    return l.sizes.every((s) => {
      if (typeof s !== "object" || s === null) return false;
      const sz = s as Record<string, unknown>;
      if (typeof sz.size !== "string" || typeof sz.quantity !== "number") return false;
      if (sz.garmentCost !== undefined && typeof sz.garmentCost !== "number") return false;
      if (sz.garmentMarkupPercent !== undefined && typeof sz.garmentMarkupPercent !== "number") return false;
      return true;
    });
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

  // An empty quote (no lines yet) is valid — see isValidQuoteInput's comment.
  // It just prices to $0 of garments/decoration; setup charges and misc fees
  // (and tax on whichever of those are taxable) still apply normally.

  // Setup/digitization charges are picked directly for the quote as a whole
  // (e.g. "Digitizing for embroidery", "Logo vectorization") — they are NOT
  // derived from any line's decoration type, so resolve them once against
  // the admin-editable catalog (lib/setup-charges-store.ts).
  const setupCharges: QuoteSetupCharge[] = (input.setupChargeIds ?? []).map((id) => {
    const match = setupChargeCatalog.find((c) => c.id === id);
    if (!match) {
      throw new QuoteInputError(`Unknown setup charge "${id}"`);
    }
    return { id: match.id, label: match.label, price: money(match.price), taxable: match.taxable ?? true };
  });

  // Pass 1: resolve garment prices and combined quantity per decoration group.
  const groupQuantity = new Map<string, number>();
  for (const line of cleanedLines) {
    const qty = line.sizes.reduce((sum, s) => sum + s.quantity, 0);
    const key = groupKey(line.decorationId, line.priceColumnId);
    groupQuantity.set(key, (groupQuantity.get(key) ?? 0) + qty);
  }

  const lines: QuoteLineResult[] = cleanedLines.map((line) => {
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

    const priceColumnLabel = line.priceColumnId
      ? decoration?.priceColumns?.find((c) => c.id === line.priceColumnId)?.label
      : undefined;

    // Customer-supplied item: no catalog garment to look up, so the garment
    // price comes from whatever manual cost/markup the admin typed on each
    // size (QuoteSizeInput.garmentCost/garmentMarkupPercent — both default
    // to 0, reproducing the original "no garment charge, decoration only"
    // behavior for a plain "other" item with no price entered) plus the
    // decoration's per-unit price (if any, pooled into the same groupQty
    // tier as every other line above).
    if (line.customerSupplied) {
      // "customer-supplied" (free) items never carry a garment charge — the
      // customer brought the item in, so no garmentCost/markup ever applies
      // even if a size row has one set from an older save. Only the "custom"
      // flow (the shop's own priced ad-hoc item) uses the typed cost/markup.
      const isCustomPriced = line.manualSource === "custom";

      const sizes: QuoteSizeResult[] = line.sizes.map((s) => {
        const roundedDecorationUnitPrice = money(decorationUnitPrice);
        const garmentCost = isCustomPriced ? money(s.garmentCost ?? 0) : 0;
        const markupPercent = isCustomPriced ? s.garmentMarkupPercent ?? 0 : 0;
        const garmentUnitPrice = money(garmentCost * (1 + markupPercent / 100));
        const garmentMarkupAmount = money(garmentUnitPrice - garmentCost);
        const unitPrice = money(garmentUnitPrice + roundedDecorationUnitPrice);
        return {
          size: s.size,
          quantity: s.quantity,
          garmentCost,
          garmentMarkupAmount,
          garmentUnitPrice,
          decorationUnitPrice: roundedDecorationUnitPrice,
          unitPrice,
          lineTotal: money(unitPrice * s.quantity),
        };
      });

      const quantity = sizes.reduce((sum, s) => sum + s.quantity, 0);
      const subtotal = money(sizes.reduce((sum, s) => sum + s.lineTotal, 0));

      // A "hat" line carries its own free-text brand/style/color (typed by
      // the admin, no catalog lookup) — show those instead of the generic
      // "Customer-supplied item" label so it renders just like a catalog
      // garment card everywhere (Items list, Preview, PDFs). A priced
      // "custom" (non-hat) item is also labeled like a catalog garment, but
      // with no style/color (just the product name) — no "customer-supplied"
      // wording anywhere. Only a free, non-hat customer-supplied item keeps
      // the original generic label.
      const isHat = line.itemType === "hat";

      return {
        styleNumber: isHat ? (line.styleNumber ?? "") : "",
        brandName: isHat
          ? line.brandNameInput?.trim() || "Hat"
          : isCustomPriced
            ? ""
            : "Customer-supplied item",
        productName: line.itemDescription ?? "Item",
        colorName: isHat ? (line.colorName ?? "") : "",
        customerSupplied: true,
        itemDescription: line.itemDescription,
        itemType: line.itemType,
        manualSource: line.manualSource,
        decorationId: line.decorationId,
        decorationLabel: decoration?.label,
        priceColumnId: line.priceColumnId,
        priceColumnLabel,
        sizes,
        quantity,
        subtotal,
        taxable: line.taxable ?? true,
      };
    }

    const product = productsByStyle.get(line.styleNumber!);
    if (!product) {
      throw new QuoteInputError(`Unknown style number "${line.styleNumber}"`);
    }
    const color = findProductColor(product, line.colorName!);

    const sizes: QuoteSizeResult[] = line.sizes.map((s) => {
      const sizeInfo = color.sizes?.find((sz) => sz.name === s.size);
      const garmentCost = sizeInfo?.price ?? product.basePrice;
      const garmentUnitPrice = money(applyGarmentMarkup(garmentCost, garmentMarkupBreakpoints));
      const garmentMarkupAmount = money(garmentUnitPrice - garmentCost);
      const roundedDecorationUnitPrice = money(decorationUnitPrice);
      const unitPrice = money(garmentUnitPrice + roundedDecorationUnitPrice);
      return {
        size: s.size,
        quantity: s.quantity,
        garmentCost: money(garmentCost),
        garmentMarkupAmount,
        garmentUnitPrice,
        decorationUnitPrice: roundedDecorationUnitPrice,
        unitPrice,
        lineTotal: money(unitPrice * s.quantity),
      };
    });

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
      taxable: line.taxable ?? true,
    };
  });

  // Ad-hoc miscellaneous fees — see QuoteInput.miscFees. Unlike setup
  // charges, there's no catalog to resolve against; the label/amount typed
  // by the admin is taken as-is (money() just cleans up float noise).
  const miscFees: QuoteMiscFee[] = (input.miscFees ?? []).map((f) => {
    const quantity = f.quantity && f.quantity > 0 ? Math.round(f.quantity) : 1;
    const amount = money(f.amount);
    return {
      label: f.label,
      amount,
      quantity,
      lineTotal: money(amount * quantity),
      taxable: f.taxable ?? true,
    };
  });

  const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0);
  const totalSetupFees = money(setupCharges.reduce((sum, c) => sum + c.price, 0));
  const totalMiscFees = money(miscFees.reduce((sum, f) => sum + f.lineTotal, 0));
  const totalGarmentAndDecoration = money(
    lines.reduce((sum, l) => sum + l.sizes.reduce((s, sz) => s + sz.lineTotal, 0), 0)
  );
  const subtotalBeforeTax = money(totalGarmentAndDecoration + totalSetupFees + totalMiscFees);

  // Tax applies only to the portion of the subtotal from items marked
  // taxable (defaults true) — see QuoteInput.taxRatePercent and each
  // line/setupCharge/miscFee's own `taxable` flag above.
  const taxRatePercent = input.taxRatePercent ?? 0;
  const taxableLinesTotal = lines.reduce(
    (sum, l) => sum + (l.taxable ? l.sizes.reduce((s, sz) => s + sz.lineTotal, 0) : 0),
    0
  );
  const taxableSetupFees = setupCharges.reduce((sum, c) => sum + (c.taxable ? c.price : 0), 0);
  const taxableMiscFees = miscFees.reduce((sum, f) => sum + (f.taxable ? f.lineTotal : 0), 0);
  const taxableSubtotal = money(taxableLinesTotal + taxableSetupFees + taxableMiscFees);
  const taxAmount = money(taxableSubtotal * (taxRatePercent / 100));
  const grandTotal = money(subtotalBeforeTax + taxAmount);

  return {
    customerName: input.customerName,
    customerCompany: input.customerCompany,
    customerEmail: input.customerEmail,
    quoteDate: input.quoteDate ?? new Date().toISOString().slice(0, 10),
    notes: input.notes,
    lines,
    setupCharges,
    miscFees,
    totalQuantity,
    totalSetupFees,
    totalMiscFees,
    totalGarmentAndDecoration,
    subtotalBeforeTax,
    taxRatePercent,
    taxableSubtotal,
    taxAmount,
    grandTotal,
    depositPercent: input.depositPercent,
  };
}
