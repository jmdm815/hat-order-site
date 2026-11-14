import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getCustomers } from "@/lib/customers-store";
import { getQuotes } from "@/lib/quotes-store";
import { groupRecordsByCustomer, summarize } from "@/lib/customer-match";

// Everything the customer page shows: the contact card, their quotes and
// invoices (newest first), every payment on those invoices, balance totals,
// and the records not linked to anyone yet (for "Link a quote or invoice").
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const { id } = await params;
  const [customers, records] = await Promise.all([getCustomers(), getQuotes()]);
  const customer = customers.find((c) => c.id === id);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  const { byCustomer, unlinked } = groupRecordsByCustomer(records, customers);
  const mine = (byCustomer.get(id) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const transactions = mine.map(summarize);
  const payments = mine
    .flatMap((r) =>
      (r.payments ?? []).map((p) => ({
        id: p.id,
        recordId: r.id,
        number: r.status === "invoice" ? r.invoiceNumber : r.quoteNumber,
        amount: p.amount,
        method: p.method === "square_card" ? "Card (online)" : p.tender ?? "manual",
        checkNumber: p.checkNumber,
        note: p.note,
        date: p.createdAt,
      }))
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const invoices = transactions.filter((t) => t.kind === "invoice");
  return NextResponse.json({
    customer,
    transactions,
    payments,
    stats: {
      balance: Math.round(invoices.reduce((s, t) => s + t.balance, 0) * 100) / 100,
      openInvoices: invoices.filter((t) => t.balance > 0).length,
      totalInvoiced: Math.round(invoices.reduce((s, t) => s + t.total, 0) * 100) / 100,
      totalPaid: Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100,
    },
    unlinked: unlinked.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(summarize),
  });
}
