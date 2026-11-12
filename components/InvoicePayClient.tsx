"use client";

import { useEffect, useState } from "react";
import InvoicePayForm, { InvoicePaymentMethod } from "./InvoicePayForm";

type InvoiceSummary = {
  id: string;
  status: "quote" | "invoice";
  invoiceNumber?: string;
  quoteNumber?: string;
  invoiceStatus?: string;
  customerName?: string;
  customerCompany?: string;
  customerEmail?: string;
  quoteDate: string;
  // Invoice-only (see lib/quote.ts's QuoteInput.dueDate) — the API never
  // sends this for a plain quote. Undefined means no due date was set, in
  // which case the "Dates" card below just shows the invoice date alone —
  // this page never guesses or defaults one.
  dueDate?: string;
  lines: Array<{
    description: string;
    details?: string[];
    colorName?: string;
    decorationLabel?: string;
    priceColumnLabel?: string;
    quantity: number;
    subtotal: number;
  }>;
  setupCharges: Array<{ id: string; label: string; price: number }>;
  miscFees: Array<{ label: string; amount: number; quantity: number; lineTotal: number }>;
  discountAmount?: number;
  discountPercent?: number;
  checkPayableTo?: string;
  checkMailTo?: string;
  grandTotal: number;
  amountPaid: number;
  balance: number;
  // See app/api/pay/[id]/route.ts's CustomerInvoiceSummary.depositPercent —
  // undefined/100 means "pay in full", so the heading below shouldn't call
  // this a "deposit".
  depositPercent?: number;
  // Deposit due under the current terms — see app/api/pay/[id]/route.ts.
  depositAmount?: number;
  // The admin's saved "amount to pay" (see app/api/pay/[id]/route.ts) —
  // what pre-fills "Amount to pay" below instead of always defaulting to
  // the full balance, matching how a ShopVox-style order page pre-fills a
  // deposit. Still just a starting point — the customer can change it.
  suggestedAmount?: number;
  // Every payment recorded so far, oldest first — see
  // app/api/pay/[id]/route.ts's toCustomerSummary. Rendered as its own
  // "Payment history" list below, each row linking to a standalone receipt
  // for just that transaction (app/api/pay/[id]/payments/[paymentId]/
  // receipt-pdf/route.ts) — this is the only receipt UI on this page now;
  // there's no separate "whole order" receipt button anymore (it used to
  // just re-render the quote/invoice PDF, which isn't an actual receipt).
  payments: Array<{
    id: string;
    amount: number;
    methodLabel: string;
    createdAt: string;
    note?: string;
  }>;
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

// "Mon, 11/02/2026" — matches the reference "Dates" card layout this
// section was designed from. Dates are stored as plain "YYYY-MM-DD" (no
// time), so parsing with an explicit midnight avoids the UTC-vs-local
// off-by-one day that `new Date("2026-11-02")` alone is prone to.
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${weekday}, ${mm}/${dd}/${d.getFullYear()}`;
}

// Calm, non-alarming labels for the de-emphasized status tag near the top
// of the page — deliberately never says "overdue," even once a due date has
// passed, matching how the admin asked this to read.
const STATUS_LABEL: Record<string, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid",
};

// Client half of the public, permanent pay page (app/pay/[id]/page.tsx) —
// one single URL per quote or invoice that never changes. Loads the
// record's customer-safe summary from /api/pay/[id], renders a
// shopVOX/competitor-style "Total / Paid / Balance" box plus an itemized
// breakdown so the customer sees roughly what they got on the quote/invoice
// PDF, an editable "amount to pay" field (pre-filled from whatever deposit
// amount the admin saved, or the full balance if none was set — see
// InvoiceSummary.suggestedAmount above — and still freely editable by the
// customer), and the card form (InvoicePayForm) that actually runs the
// charge through Square. Works the same whether the record is still a
// plain quote (a pre-invoice deposit) or has been converted to an invoice.
export default function InvoicePayClient({ id }: { id: string }) {
  const [invoice, setInvoice] = useState<InvoiceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [paymentReceiptLoadingId, setPaymentReceiptLoadingId] = useState<string | null>(null);
  const [paymentReceiptError, setPaymentReceiptError] = useState<string | null>(null);

  function load() {
    fetch(`/api/pay/${id}`)
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 409) setPending(true);
          else setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((data: { invoice: InvoiceSummary } | null) => {
        if (data?.invoice) {
          setInvoice(data.invoice);
          // Pre-fill from the admin's saved deposit/suggested amount when
          // there is one (clamped server-side to the current balance),
          // falling back to the full balance like before when there isn't.
          const prefill =
            data.invoice.suggestedAmount && data.invoice.suggestedAmount > 0
              ? data.invoice.suggestedAmount
              : data.invoice.balance;
          setAmountInput(prefill > 0 ? prefill.toFixed(2) : "0.00");
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handlePay(sourceId: string, method: InvoicePaymentMethod) {
    if (!invoice) return;
    setError(null);
    const amount = Number(amountInput);
    try {
      const res = await fetch(`/api/pay/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, amount, method }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Payment failed");
      setInvoice(data.invoice);
      setAmountInput(data.invoice.balance > 0 ? data.invoice.balance.toFixed(2) : "0.00");
      // No email is collected pre-payment anymore — this payment's own
      // receipt is now available right below, in "Payment history".
      setSuccessMessage(
        data.invoice.balance <= 0
          ? "Payment received — this invoice is now paid in full. Thank you!"
          : `Payment of ${money(amount)} received. Remaining balance: ${money(data.invoice.balance)}.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    }
  }

  // Opens a blank tab synchronously so the browser treats it as a direct
  // result of the click rather than blocking it as a popup, then navigates
  // it straight to the receipt route — see components/AdminQuoteBuilder.tsx's
  // downloadPdf for why this is a real navigation rather than a
  // fetch()-built Blob object URL (the route's own "inline; filename=..."
  // Content-Disposition only reliably determines the saved filename on a
  // real navigation; a fetch+Blob lost it entirely, which is what was
  // still showing a random blob-id filename on save). Produces a
  // standalone receipt for one specific entry in the payment-history list
  // below (see app/api/pay/[id]/payments/[paymentId]/receipt-pdf/route.ts).
  function downloadPaymentReceipt(paymentId: string) {
    setPaymentReceiptLoadingId(paymentId);
    setPaymentReceiptError(null);
    try {
      const url = `/api/pay/${id}/payments/${paymentId}/receipt-pdf`;
      const tab = window.open(url, "_blank");
      if (!tab) window.open(url, "_blank");
    } catch {
      setPaymentReceiptError("Failed to open the receipt — check your connection and try again.");
    } finally {
      setPaymentReceiptLoadingId(null);
    }
  }

  if (loading) {
    return <p className="text-white/40 text-sm">Loading…</p>;
  }

  if (pending) {
    return (
      <div className="bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl p-6">
        <h1 className="text-xl font-bold text-white">Almost ready</h1>
        <p className="mt-2 text-sm text-white/60">
          This quote is still being finalized. Please check back shortly, or contact us if you have questions.
        </p>
      </div>
    );
  }

  if (notFound || !invoice) {
    return (
      <div className="bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl p-6">
        <h1 className="text-xl font-bold text-white">Not found</h1>
        <p className="mt-2 text-sm text-white/60">
          This payment link doesn&apos;t match an open quote or invoice. If you think this is a mistake,
          please contact us.
        </p>
      </div>
    );
  }

  const paidInFull = invoice.balance <= 0;
  const depositRemaining = Math.max(
    0,
    Math.round(((invoice.depositAmount ?? invoice.grandTotal) - invoice.amountPaid) * 100) / 100
  );
  // Deposit row: the full deposit before anything is paid; what's still owed
  // toward it after a partial payment (e.g. 50% terms, 25% paid -> "Deposit
  // remaining (25%)"); "Paid" once payments cover it.
  const hasPartialTerms = Boolean(invoice.depositPercent && invoice.depositPercent < 100);
  const pctOfTotal = (amount: number) =>
    invoice.grandTotal > 0 ? Math.round((amount / invoice.grandTotal) * 1000) / 10 : 0;
  const depositRow =
    depositRemaining <= 0
      ? {
          label: hasPartialTerms ? `Deposit (${invoice.depositPercent}%)` : "Deposit",
          value: "Paid",
          met: true,
        }
      : invoice.amountPaid > 0
        ? {
            label: `Deposit remaining${hasPartialTerms ? ` (${pctOfTotal(depositRemaining)}%)` : ""}`,
            value: money(depositRemaining),
            met: false,
          }
        : {
            label: hasPartialTerms ? `Deposit (${invoice.depositPercent}%)` : "Deposit",
            value: money(invoice.depositAmount ?? invoice.grandTotal),
            met: false,
          };
  const amountNum = Number(amountInput);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= invoice.balance + 0.02;

  return (
    <div>
      <p className="text-xs font-medium text-white/50 uppercase tracking-wide">
        {invoice.invoiceNumber
          ? `Invoice ${invoice.invoiceNumber}`
          : invoice.quoteNumber
            ? `Quote ${invoice.quoteNumber}${
                invoice.depositPercent && invoice.depositPercent < 100 ? " — deposit" : ""
              }`
            : invoice.status === "invoice"
              ? "Invoice"
              : "Quote"}
        {/* De-emphasized status tag — same quiet, small-caps treatment as
            the invoice/quote number next to it, not a bold centered red
            banner. Only invoices carry invoiceStatus; a plain quote shows
            nothing here. Never reads "overdue," even past the due date. */}
        {invoice.status === "invoice" && invoice.invoiceStatus && (
          <span className="text-white/30"> · {STATUS_LABEL[invoice.invoiceStatus] ?? invoice.invoiceStatus}</span>
        )}
      </p>
      <h1 className="text-2xl font-bold text-white mt-1">
        {invoice.customerCompany || invoice.customerName || "Your invoice"}
      </h1>
      {invoice.customerCompany && invoice.customerName && (
        <p className="text-sm text-white/60">{invoice.customerName}</p>
      )}

      {/* "Dates" card — invoice date always shown; due date only once the
          admin has set one (invoice-only, see InvoiceSummary.dueDate). */}
      <div className="mt-6 bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl p-4">
        <p className="text-xs font-medium text-white/50 uppercase tracking-wide mb-3">Dates</p>
        <div className="relative space-y-4">
          {invoice.dueDate && (
            <span className="absolute left-[3px] top-2 bottom-2 w-px bg-white/15" aria-hidden="true" />
          )}
          <div className="relative flex items-start gap-3">
            <span className="relative z-10 mt-1 h-[7px] w-[7px] rounded-full bg-white/40 shrink-0" />
            <div>
              <p className="text-xs text-white/50">{invoice.status === "invoice" ? "Invoice Date" : "Quote Date"}</p>
              <p className="text-sm text-white font-medium">{formatDate(invoice.quoteDate)}</p>
            </div>
          </div>
          {invoice.dueDate && (
            <div className="relative flex items-start gap-3">
              <span className="relative z-10 mt-1 h-[7px] w-[7px] rounded-full bg-white/40 shrink-0" />
              <div>
                <p className="text-xs text-white/50">Due Date</p>
                <p className="text-sm text-white font-medium">{formatDate(invoice.dueDate)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl overflow-hidden">
        <div className="divide-y divide-white/5">
          {invoice.lines.map((line, i) => (
            <div key={i} className="px-4 py-3 flex items-start justify-between gap-4 text-sm">
              <div>
                <p className="font-medium text-white">
                  {line.quantity} × {line.description}
                  {line.colorName ? ` — ${line.colorName}` : ""}
                </p>
                {line.details?.map((d, j) => (
                  <p key={j} className="text-white/80 text-xs mt-0.5">
                    {d}
                  </p>
                ))}
                {line.decorationLabel && (
                  <p className="text-white/50 text-xs mt-0.5">
                    {line.decorationLabel}
                    {line.priceColumnLabel ? ` (${line.priceColumnLabel})` : ""}
                  </p>
                )}
              </div>
              <p className="text-white font-medium shrink-0">{money(line.subtotal)}</p>
            </div>
          ))}
          {invoice.setupCharges.map((charge) => (
            <div key={charge.id} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
              <p className="text-white">{charge.label}</p>
              <p className="text-white font-medium shrink-0">{money(charge.price)}</p>
            </div>
          ))}
          {invoice.miscFees.map((fee, i) => (
            <div key={i} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
              <p className="text-white">
                {fee.label}
                {fee.quantity > 1 ? ` × ${fee.quantity}` : ""}
              </p>
              <p className="text-white font-medium shrink-0">{money(fee.lineTotal)}</p>
            </div>
          ))}
        </div>

        <div className="bg-white/5 px-4 py-3 space-y-1.5 text-sm">
          {(invoice.discountAmount ?? 0) > 0 && (
            <div className="flex justify-between">
              <span className="text-white/70">Military discount ({invoice.discountPercent ?? 10}%)</span>
              <span className="text-white font-medium">-{money(invoice.discountAmount ?? 0)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-white/70">Total</span>
            <span className="text-white font-medium">{money(invoice.grandTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">{depositRow.label}</span>
            <span className={`font-medium ${depositRow.met ? "text-green-400" : "text-white"}`}>{depositRow.value}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">Paid</span>
            <span className="text-white font-medium">{money(invoice.amountPaid)}</span>
          </div>
          <div className="flex justify-between pt-1.5 border-t border-white/10">
            <span className="font-semibold text-white">Balance</span>
            {/* Neutral either way — no red for an unpaid/partial balance.
                The status word itself (Unpaid / Partially paid) lives in the
                quiet tag up top, not here. */}
            <span className={`font-bold ${paidInFull ? "text-green-400" : "text-white"}`}>
              {money(invoice.balance)}
            </span>
          </div>
        </div>
      </div>

      {!paidInFull && invoice.checkPayableTo && (
        <div className="mt-4 bg-black border border-white/10 rounded-2xl p-4 text-sm">
          <p className="font-medium text-white">Prefer to pay by check?</p>
          <p className="mt-1 text-white/70">
            Make checks payable to <span className="text-white">{invoice.checkPayableTo}</span>
            {invoice.checkMailTo ? (
              <>
                {" "}and mail or drop off at <span className="text-white">{invoice.checkMailTo}</span>
              </>
            ) : null}
            . Please write {invoice.invoiceNumber ? `invoice ${invoice.invoiceNumber}` : "your order number"} on the memo line.
          </p>
        </div>
      )}

      {successMessage && (
        <p className="mt-4 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          {successMessage}
        </p>
      )}

      {invoice.payments.length > 0 && (
        <div className="mt-4 bg-black border border-white/10 rounded-2xl p-4">
          <p className="text-sm font-medium text-white">Payment history</p>
          <p className="mt-1 text-xs text-white/40">
            Each payment below is its own transaction — get a receipt for just that one.
          </p>
          <div className="mt-3 space-y-2">
            {invoice.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 bg-white/5 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium">{money(p.amount)}</p>
                  <p className="text-xs text-white/50 truncate">
                    {new Date(p.createdAt).toLocaleDateString()} · {p.methodLabel}
                    {p.note ? ` · ${p.note}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => downloadPaymentReceipt(p.id)}
                  disabled={paymentReceiptLoadingId === p.id}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-xl border border-white/20 text-white hover:bg-white/5 disabled:opacity-40"
                >
                  {paymentReceiptLoadingId === p.id ? "Loading…" : "Receipt"}
                </button>
              </div>
            ))}
          </div>
          {paymentReceiptError && <p className="mt-2 text-xs text-red font-medium">{paymentReceiptError}</p>}
        </div>
      )}

      {!paidInFull && (
        <div className="mt-6">
          <label className="block text-sm font-medium text-white mb-1" htmlFor="pay-amount">
            Amount to pay
          </label>
          {invoice.depositPercent && invoice.depositPercent < 100 && depositRemaining > 0 ? (
            <p className="text-xs text-white/60 mb-2">
              {invoice.amountPaid > 0
                ? `Remaining deposit due now: ${money(depositRemaining)}.`
                : `${invoice.depositPercent}% deposit due now: ${money(depositRemaining)}.`}{" "}
              The rest is due at pickup.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50">$</span>
              <input
                id="pay-amount"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                inputMode="decimal"
                className="w-full bg-black border border-white/20 rounded-xl pl-7 pr-3 py-2 text-sm outline-none focus:border-red focus:ring-2 focus:ring-red/20"
              />
            </div>
            <button
              type="button"
              onClick={() => setAmountInput(invoice.balance.toFixed(2))}
              className="text-xs px-3 py-2 rounded-xl border border-white/20 text-white/70 hover:bg-white/5 shrink-0"
            >
              Pay full balance ({money(invoice.balance)})
            </button>
          </div>
          {!amountValid && amountInput !== "" && (
            <p className="mt-1 text-xs text-red">Enter an amount between $0.01 and {money(invoice.balance)}.</p>
          )}

          <div className="mt-5">
            <InvoicePayForm
              amount={amountValid ? amountNum : 0}
              disabled={!amountValid}
              onPay={handlePay}
            />
          </div>
          {error && <p className="mt-2 text-sm text-red font-medium">{error}</p>}
        </div>
      )}
    </div>
  );
}
