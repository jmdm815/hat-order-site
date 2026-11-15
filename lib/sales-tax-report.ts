import type { QuoteRecord } from "./quotes-store";
import { SHOP_TIME_ZONE } from "./quote";

// Sales tax report (Admin → Reports): invoices dated in a range, split into
// taxable and non-taxable sales, like ShopVox's Sales Tax report. An invoice
// with tax turned on (taxRatePercent > 0) counts its taxable lines as
// taxable sales; everything else — tax turned off, or lines marked
// non-taxable — is non-taxable. Amounts are after discounts, before tax.

export type SalesTaxRow = {
  id: string;
  invoiceNumber: string;
  date: string; // YYYY-MM-DD
  customer: string;
  taxRatePercent: number;
  totalSales: number;
  taxableSales: number;
  nonTaxableSales: number;
  taxCollected: number;
  invoiceTotal: number;
  paymentStatus: string;
};

export type SalesTaxReport = {
  from: string;
  to: string;
  totals: { totalSales: number; taxableSales: number; nonTaxableSales: number; taxCollected: number; invoices: number };
  byRate: { ratePercent: number; taxableSales: number; taxCollected: number; invoices: number }[];
  rows: SalesTaxRow[];
  skipped: { invoiceNumber: string; reason: string }[];
};

const money = (n: number) => Math.round(n * 100) / 100;

const shopDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: SHOP_TIME_ZONE });

/** The invoice's date: its document date, else when it became an invoice, else when it was created. */
export function invoiceDate(r: QuoteRecord): string {
  return r.input.quoteDate || (r.convertedAt ? shopDate(r.convertedAt) : shopDate(r.createdAt));
}

export function buildSalesTaxReport(records: QuoteRecord[], from: string, to: string): SalesTaxReport {
  const rows: SalesTaxRow[] = [];
  const skipped: SalesTaxReport["skipped"] = [];
  for (const r of records) {
    if (r.status !== "invoice" || r.deletedAt) continue;
    const date = invoiceDate(r);
    if (date < from || date > to) continue;
    const c = r.computed;
    const number = r.invoiceNumber ?? r.quoteNumber ?? r.id.slice(0, 8);
    if (!c || typeof c.subtotalBeforeTax !== "number") {
      skipped.push({ invoiceNumber: number, reason: "No pricing saved on this invoice" });
      continue;
    }
    const rate = r.input.taxRatePercent ?? c.taxRatePercent ?? 0;
    const totalSales = money(c.subtotalBeforeTax - (c.discountAmount ?? 0));
    const taxableSales = rate > 0 ? money(Math.min(c.taxableSubtotal ?? 0, totalSales)) : 0;
    rows.push({
      id: r.id,
      invoiceNumber: number,
      date,
      customer: [r.input.customerCompany, r.input.customerName].filter(Boolean).join(" — ") || "—",
      taxRatePercent: rate,
      totalSales,
      taxableSales,
      nonTaxableSales: money(totalSales - taxableSales),
      taxCollected: rate > 0 ? money(c.taxAmount ?? 0) : 0,
      invoiceTotal: money(c.grandTotal ?? totalSales),
      paymentStatus: r.invoiceStatus ?? "unpaid",
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNumber.localeCompare(b.invoiceNumber));
  const sum = (k: keyof SalesTaxRow) => money(rows.reduce((s, x) => s + (x[k] as number), 0));
  const rates = new Map<number, { taxableSales: number; taxCollected: number; invoices: number }>();
  for (const x of rows) {
    if (x.taxRatePercent <= 0) continue;
    const e = rates.get(x.taxRatePercent) ?? { taxableSales: 0, taxCollected: 0, invoices: 0 };
    e.taxableSales = money(e.taxableSales + x.taxableSales);
    e.taxCollected = money(e.taxCollected + x.taxCollected);
    e.invoices++;
    rates.set(x.taxRatePercent, e);
  }
  return {
    from,
    to,
    totals: {
      totalSales: sum("totalSales"),
      taxableSales: sum("taxableSales"),
      nonTaxableSales: sum("nonTaxableSales"),
      taxCollected: sum("taxCollected"),
      invoices: rows.length,
    },
    byRate: [...rates.entries()].sort((a, b) => b[0] - a[0]).map(([ratePercent, v]) => ({ ratePercent, ...v })),
    rows,
    skipped,
  };
}
