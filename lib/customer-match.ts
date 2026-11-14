import type { Customer } from "./types";
import type { QuoteRecord } from "./quotes-store";

// ---------------------------------------------------------------------------
// Which saved customer owns each quote/invoice (customer pages,
// app/admin/customers/[id]). A record belongs to exactly one customer:
//   1. input.customerId, when set (picked in the builder / linked by hand)
//   2. otherwise the customer with the same email (ties: same name wins)
//   3. otherwise the customer with the same name ("Name" or "Name(Company)",
//      ignoring spaces/punctuation/case)
// Anything left over is "unlinked" and can be linked from a customer page.
// ---------------------------------------------------------------------------

const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function nameKeys(c: Customer): string[] {
  const keys = [norm(c.name)];
  if (c.company) keys.push(norm(`${c.name}${c.company}`), norm(`${c.name}(${c.company})`));
  for (const ct of c.contacts ?? []) {
    keys.push(norm(ct.name), norm(`${ct.name}${c.company ?? c.name}`), norm(`${ct.name}(${c.company ?? c.name})`));
  }
  return keys.filter(Boolean);
}

function emails(c: Customer): string[] {
  return [c.email, ...(c.contacts ?? []).map((ct) => ct.email)]
    .map((e) => (e ?? "").trim().toLowerCase())
    .filter(Boolean);
}

export function ownerOf(record: QuoteRecord, customers: Customer[]): Customer | undefined {
  const i = record.input;
  if (i.customerId) {
    const c = customers.find((x) => x.id === i.customerId);
    if (c) return c;
  }
  const email = (i.customerEmail ?? "").trim().toLowerCase();
  const name = norm(i.customerName);
  const nameWithCompany = norm(`${i.customerName ?? ""}${i.customerCompany ?? ""}`);
  if (email) {
    const byEmail = customers.filter((c) => emails(c).includes(email));
    if (byEmail.length) return byEmail.find((c) => nameKeys(c).includes(name)) ?? byEmail[0];
  }
  if (name) {
    return customers.find((c) => {
      const keys = nameKeys(c);
      return keys.includes(name) || keys.includes(nameWithCompany);
    });
  }
  return undefined;
}

export function groupRecordsByCustomer(records: QuoteRecord[], customers: Customer[]) {
  const byCustomer = new Map<string, QuoteRecord[]>();
  const unlinked: QuoteRecord[] = [];
  for (const r of records) {
    const c = ownerOf(r, customers);
    if (!c) unlinked.push(r);
    else byCustomer.set(c.id, [...(byCustomer.get(c.id) ?? []), r]);
  }
  return { byCustomer, unlinked };
}

export function recordBalance(r: QuoteRecord): number {
  if (r.status !== "invoice") return 0;
  return Math.max(0, Math.round((r.computed.grandTotal - (r.amountPaid ?? 0)) * 100) / 100);
}

export type RecordSummary = {
  id: string;
  kind: "quote" | "invoice";
  number: string;
  date: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
  contactName?: string;
  itemsSummary: string;
};

export function summarize(r: QuoteRecord): RecordSummary {
  const total = r.computed.grandTotal;
  const paid = r.amountPaid ?? 0;
  let status: string;
  if (r.status === "invoice") {
    status = paid >= total - 0.005 && paid > 0 ? "Paid" : paid > 0 ? "Partially paid" : "Open";
  } else {
    status = r.linkedInvoiceId ? `Converted → ${r.linkedInvoiceNumber ?? "invoice"}` : paid > 0 ? "Deposit paid" : "Quote";
  }
  const items = [
    ...r.input.lines.map((l) => l.itemDescription || [l.styleNumber, l.colorName].filter(Boolean).join(" ")),
    ...(r.input.miscFees ?? []).map((f) => f.label.split(" — ")[0]),
  ].filter(Boolean);
  return {
    id: r.id,
    kind: r.status === "invoice" ? "invoice" : "quote",
    number: (r.status === "invoice" ? r.invoiceNumber : r.quoteNumber) ?? r.quoteNumber ?? r.id.slice(0, 8),
    date: r.input.quoteDate ?? r.createdAt.slice(0, 10),
    total,
    paid,
    balance: recordBalance(r),
    status,
    contactName: r.input.customerName,
    itemsSummary: items.slice(0, 3).join(", ") + (items.length > 3 ? ` +${items.length - 3} more` : ""),
  };
}
