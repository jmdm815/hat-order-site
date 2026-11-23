import { put, list } from "@vercel/blob";
import { isPersistent } from "./pricing-store";
import type { ComputedQuote } from "./quote";

// ---------------------------------------------------------------------------
// Special invoices — reseller copies of a normal invoice/quote. A reseller
// (e.g. Amazing T-Shirts) sends the normal invoice to their own customer and
// keeps a commission; the special invoice is what they owe JM Media: the
// same items with commissionPercent taken off the DECORATION price only
// (garment, setup charges and misc fees are unchanged).
// Numbered SI-1001, SI-1002… Blob: special-invoices.json → SpecialInvoice[].
// `source` is a snapshot of the original record's computed pricing taken when
// the special invoice was made (or last refreshed), so later edits to the
// original don't silently change it.
// ---------------------------------------------------------------------------

export type SpecialInvoice = {
  id: string;
  number: string;
  date: string; // YYYY-MM-DD
  sourceId: string;
  sourceNumber?: string; // INV-0022 / QT-1044
  commissionPercent: number; // taken off decoration only
  showCommissionNote: boolean; // print the commission summary on the PDF
  status: "unpaid" | "paid";
  // "due-on-receipt" = 100% due on receipt, no deposit (default for new
  // ones); "source" = keep the original invoice's terms (deposit/net terms).
  terms?: "due-on-receipt" | "source";
  notes?: string; // printed on the PDF
  source: ComputedQuote;
  createdAt: string;
  updatedAt: string;
};

const BLOB_PATHNAME = "special-invoices.json";
let memory: SpecialInvoice[] | null = null;

async function readAll(): Promise<SpecialInvoice[]> {
  if (!isPersistent()) return memory ?? [];
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === BLOB_PATHNAME);
    if (!match) return [];
    const res = await fetch(`${match.url}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    return res.ok ? ((await res.json()) as SpecialInvoice[]) : [];
  } catch (err) {
    console.error("special-invoices-store: read failed", err);
    return [];
  }
}

async function writeAll(data: SpecialInvoice[]) {
  memory = data;
  if (!isPersistent()) return;
  await put(BLOB_PATHNAME, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export async function getSpecialInvoices(): Promise<SpecialInvoice[]> {
  return (await readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSpecialInvoice(id: string): Promise<SpecialInvoice | undefined> {
  return (await readAll()).find((q) => q.id === id);
}

export async function createSpecialInvoice(
  input: Omit<SpecialInvoice, "id" | "number" | "createdAt" | "updatedAt">
): Promise<SpecialInvoice> {
  const all = await readAll();
  const maxNo = all.reduce((m, q) => Math.max(m, Number(q.number.replace(/\D/g, "")) || 0), 1000);
  const now = new Date().toISOString();
  const rec: SpecialInvoice = { ...input, id: crypto.randomUUID(), number: `SI-${maxNo + 1}`, createdAt: now, updatedAt: now };
  await writeAll([...all, rec]);
  return rec;
}

export async function updateSpecialInvoice(id: string, patch: Partial<SpecialInvoice>): Promise<SpecialInvoice | null> {
  const all = await readAll();
  const i = all.findIndex((q) => q.id === id);
  if (i < 0) return null;
  const { id: _i, number: _n, createdAt: _c, ...rest } = patch;
  all[i] = { ...all[i], ...rest, updatedAt: new Date().toISOString() };
  await writeAll(all);
  return all[i];
}

export async function deleteSpecialInvoice(id: string): Promise<void> {
  await writeAll((await readAll()).filter((q) => q.id !== id));
}

// ---------------------------------------------------------------- pricing
const money = (n: number) => Math.round(n * 100) / 100;

export type CommissionSummary = {
  originalTotal: number;
  decorationTotal: number; // original decoration $ on counted (non-optional) lines
  commissionAmount: number;
  netTotal: number;
};

/**
 * The original computed quote with commissionPercent taken off each size
 * row's decoration unit price. Only decoration changes: garment price,
 * setup charges and misc fees are untouched. Totals, discount and tax are
 * recomputed from the adjusted lines.
 */
export function applyCommission(src: ComputedQuote, pct: number): { computed: ComputedQuote; summary: CommissionSummary } {
  const f = Math.min(100, Math.max(0, pct)) / 100;
  let decorationTotal = 0;
  let commission = 0;
  let commissionTaxable = 0;

  const lines = src.lines.map((line) => {
    const sizes = line.sizes.map((s) => {
      const deco = s.decorationUnitPrice ?? 0;
      const newDeco = money(deco * (1 - f));
      const cut = money(deco - newDeco);
      const unitPrice = money(s.unitPrice - cut);
      const lineTotal = money(unitPrice * s.quantity);
      if (!line.optional) {
        decorationTotal += deco * s.quantity;
        const lineCut = money(s.lineTotal - lineTotal);
        commission += lineCut;
        if (line.taxable !== false) commissionTaxable += lineCut;
      }
      return { ...s, decorationUnitPrice: newDeco, unitPrice, lineTotal, computedUnitPrice: unitPrice };
    });
    const subtotal = money(sizes.reduce((t, s) => t + s.lineTotal, 0));
    return {
      ...line,
      sizes,
      subtotal,
      ...(line.computedDecorationUnitPrice !== undefined
        ? { computedDecorationUnitPrice: money(line.computedDecorationUnitPrice * (1 - f)) }
        : {}),
    };
  });

  commission = money(commission);
  const totalGarmentAndDecoration = money(src.totalGarmentAndDecoration - commission);
  const subtotalBeforeTax = money(src.subtotalBeforeTax - commission);
  const discountFactor = src.subtotalBeforeTax > 0 ? src.discountAmount / src.subtotalBeforeTax : 0;
  const discountAmount = money(subtotalBeforeTax * discountFactor);
  const taxableSubtotal = money(Math.max(0, src.taxableSubtotal - commissionTaxable * (1 - discountFactor)));
  const taxAmount = money((taxableSubtotal * (src.taxRatePercent || 0)) / 100);
  const grandTotal = money(subtotalBeforeTax - discountAmount + taxAmount);

  return {
    computed: {
      ...src,
      lines,
      totalGarmentAndDecoration,
      subtotalBeforeTax,
      discountAmount,
      taxableSubtotal,
      taxAmount,
      grandTotal,
    },
    summary: {
      originalTotal: src.grandTotal,
      decorationTotal: money(decorationTotal),
      commissionAmount: money(src.grandTotal - grandTotal),
      netTotal: grandTotal,
    },
  };
}

/** What the PDF renders: adjusted pricing, no online pay link, notes. */
export function specialInvoicePdfQuote(si: SpecialInvoice): ComputedQuote {
  const { computed, summary } = applyCommission(si.source, si.commissionPercent);
  const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const parts: string[] = [];
  if (si.showCommissionNote && si.commissionPercent > 0) {
    parts.push(
      `Reseller pricing: ${si.commissionPercent}% commission taken off the decoration price (${usd(summary.commissionAmount)} off the ${usd(summary.originalTotal)} total${si.sourceNumber ? ` on ${si.sourceNumber}` : ""}).`
    );
  }
  if (si.notes) parts.push(si.notes);
  else if (si.source.customerNotes) parts.push(si.source.customerNotes);
  return {
    ...computed,
    quoteDate: si.date,
    hidePaymentLink: true,
    ...(si.terms === "source"
      ? {}
      : { depositPercent: undefined, netTermsDays: undefined, termsBlank: undefined }),
    customerNotes: parts.join("\n\n") || undefined,
  };
}
