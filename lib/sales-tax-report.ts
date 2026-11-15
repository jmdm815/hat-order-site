import type { QuoteRecord } from "./quotes-store";
import { SHOP_TIME_ZONE } from "./quote";

// Sales tax report (Admin → Reports). Basis "paid" (cash): payments received
// in the range, each counted for its share of the invoice (a half payment
// counts half the sales and half the tax). Basis "invoice" (accrual):
// invoices dated in the range, in full. Either way, split into
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
  amountPaidInRange?: number; // paid basis: payments received in the range
};

export type SalesTaxBasis = "paid" | "invoice";

export type SalesTaxReport = {
  from: string;
  to: string;
  basis: SalesTaxBasis;
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

export function buildSalesTaxReport(
  records: QuoteRecord[],
  from: string,
  to: string,
  basis: SalesTaxBasis = "invoice"
): SalesTaxReport {
  const rows: SalesTaxRow[] = [];
  const skipped: SalesTaxReport["skipped"] = [];
  for (const r of records) {
    if (r.status !== "invoice" || r.deletedAt) continue;
    const number = r.invoiceNumber ?? r.quoteNumber ?? r.id.slice(0, 8);

    // Which part of this invoice falls in the range: all of it (invoice
    // date in range), or — paid basis — the share covered by payments
    // received in the range.
    let share = 1;
    let date = invoiceDate(r);
    let paidInRange: number | undefined;
    if (basis === "paid") {
      const pays = (r.payments ?? []).filter((p) => {
        const d = shopDate(p.createdAt);
        return d >= from && d <= to;
      });
      if (!pays.length) continue;
      paidInRange = money(pays.reduce((sum, p) => sum + p.amount, 0));
      date = shopDate(pays[pays.length - 1].createdAt);
    } else if (date < from || date > to) {
      continue;
    }

    const c = r.computed;
    if (!c || typeof c.subtotalBeforeTax !== "number") {
      skipped.push({ invoiceNumber: number, reason: "No pricing saved on this invoice" });
      continue;
    }
    const rate = r.input.taxRatePercent ?? c.taxRatePercent ?? 0;
    const fullSales = money(c.subtotalBeforeTax - (c.discountAmount ?? 0));
    const fullTaxable = rate > 0 ? money(Math.min(c.taxableSubtotal ?? 0, fullSales)) : 0;
    const fullTax = rate > 0 ? money(c.taxAmount ?? 0) : 0;
    const grand = money(c.grandTotal ?? fullSales + fullTax);
    if (paidInRange !== undefined) share = grand > 0 ? Math.min(1, paidInRange / grand) : 1;
    const totalSales = money(fullSales * share);
    const taxableSales = money(fullTaxable * share);
    rows.push({
      id: r.id,
      invoiceNumber: number,
      date,
      customer: [r.input.customerCompany, r.input.customerName].filter(Boolean).join(" — ") || "—",
      taxRatePercent: rate,
      totalSales,
      taxableSales,
      nonTaxableSales: money(totalSales - taxableSales),
      taxCollected: money(fullTax * share),
      invoiceTotal: grand,
      paymentStatus: r.invoiceStatus ?? "unpaid",
      amountPaidInRange: paidInRange,
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
    basis,
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
