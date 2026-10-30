"use client";

import { useState } from "react";
import { QuoteRecord, InvoicePaymentEntry } from "@/lib/quotes-store";

type Props = {
  record: QuoteRecord;
  onClose: () => void;
  onUpdated: (record: QuoteRecord) => void;
};

const TENDER_LABEL: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  other: "Other",
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Popup opened from the "Payment"/"Deposit" button in
// AdminSavedQuotesList.tsx — one place that shows the full picture (total,
// paid, balance, payment terms, payment history), lets the admin manually
// record a real payment (e.g. "$40 cash") instead of only flipping a status
// flag, and set the deposit amount that pre-fills this record's permanent,
// branded pay page (app/pay/[id]) — the single link always handed to the
// customer now, for a plain quote's pre-invoice deposit just as well as an
// invoice's balance (see lib/quotes-store.ts's recordInvoicePayment /
// setSuggestedPaymentAmount, which both support any record). Calls
// app/api/admin/quotes/[id]/record-payment/route.ts, which shares
// recordInvoicePayment() with the real Square card charges collected
// through that same customer-facing page, so amountPaid stays consistent no
// matter how the money came in.
export default function AdminInvoicePaymentModal({ record, onClose, onUpdated }: Props) {
  const isInvoice = record.status === "invoice";
  const grandTotal = record.computed.grandTotal;
  const amountPaid = record.amountPaid ?? 0;
  const balance = Math.max(0, Math.round((grandTotal - amountPaid) * 100) / 100);
  const depositPercent = record.computed.depositPercent;
  const depositAmount =
    depositPercent && depositPercent < 100 ? Math.round(grandTotal * (depositPercent / 100) * 100) / 100 : undefined;
  // What the deposit-amount input below defaults to: an invoice defaults to
  // the full balance; a quote defaults to its payment-terms deposit (or the
  // full total if "pay in full"/no terms set) — same defaulting logic as
  // app/api/admin/quotes/[id]/payment-link/route.ts uses server-side when no
  // amount is sent at all, just mirrored here so the input starts prefilled
  // with what would happen anyway.
  const suggestedLinkAmount = isInvoice ? balance : (depositAmount ?? grandTotal);
  const payPageUrl =
    typeof window !== "undefined" ? `${window.location.origin}/pay/${record.id}` : `/pay/${record.id}`;

  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : "0.00");
  const [tender, setTender] = useState<InvoicePaymentEntry["tender"]>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [linkAmount, setLinkAmount] = useState(suggestedLinkAmount > 0 ? suggestedLinkAmount.toFixed(2) : "0.00");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= balance + 0.02;

  const linkAmountNum = Number(linkAmount);
  const linkAmountValid = Number.isFinite(linkAmountNum) && linkAmountNum > 0 && linkAmountNum <= grandTotal + 0.02;

  async function submit(payAmount: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${record.id}/record-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: payAmount, tender, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to record payment");
      onUpdated(data.record);
      setNote("");
      const newBalance = Math.max(0, Math.round((grandTotal - (data.record.amountPaid ?? 0)) * 100) / 100);
      setAmount(newBalance > 0 ? newBalance.toFixed(2) : "0.00");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetToUnpaid() {
    if (!confirm("Clear every recorded payment on this record and reset it to unpaid?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${record.id}/record-payment`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to reset payments");
      onUpdated(data.record);
      setAmount(grandTotal.toFixed(2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDepositAmount() {
    if (!linkAmountValid) return;
    setLinkBusy(true);
    setLinkMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${record.id}/payment-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: linkAmountNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save the deposit amount");
      onUpdated(data.record);
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(payPageUrl).catch(() => {});
        setLinkMessage("Deposit amount saved and pay page link copied.");
      } else {
        setLinkMessage("Deposit amount saved.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLinkBusy(false);
    }
  }

  function handleCopyLink() {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(payPageUrl)
      .then(() => setLinkMessage("Link copied."))
      .catch(() => {});
  }

  const payments = record.payments ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-admin-bg/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-admin-card rounded-2xl shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-admin-ink">Payment</h2>
            <p className="text-xs text-admin-ink/72">
              {isInvoice ? record.invoiceNumber ?? "Invoice" : record.quoteNumber ?? "Quote"}
            </p>
          </div>
          <button onClick={onClose} className="text-admin-ink/62 hover:text-admin-ink text-sm px-1">
            ✕
          </button>
        </div>

        <div className="mt-4 bg-admin-ink/5 rounded-xl px-3 py-2.5 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-admin-ink/88">Total</span>
            <span className="font-medium text-admin-ink">{money(grandTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-admin-ink/88">Paid</span>
            <span className="font-medium text-admin-ink">{money(amountPaid)}</span>
          </div>
          <div className="flex justify-between pt-1 border-t border-admin-ink/10">
            <span className="font-semibold text-admin-ink">Balance</span>
            <span className={`font-bold ${balance <= 0 ? "text-green-700" : "text-admin-accent"}`}>{money(balance)}</span>
          </div>
          {depositAmount !== undefined && (
            <p className="text-xs text-admin-ink/72 pt-1">
              Payment terms: {depositPercent}% deposit ({money(depositAmount)}), balance due at pickup
            </p>
          )}
        </div>

        {payments.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-admin-ink/80 uppercase tracking-wide mb-1.5">Payment history</p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between items-baseline gap-2 text-xs text-admin-ink/88">
                  <span className="truncate">
                    {new Date(p.createdAt).toLocaleDateString()} —{" "}
                    {p.method === "square_card" ? "Card" : TENDER_LABEL[p.tender ?? "other"]}
                    {p.note ? ` (${p.note})` : ""}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="font-medium">{money(p.amount)}</span>
                    <a
                      href={`/api/pay/${record.id}/payments/${p.id}/receipt-pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      Receipt
                    </a>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-admin-ink/10 pt-4">
          <p className="text-xs font-medium text-admin-ink/80 uppercase tracking-wide mb-2">Pay page link</p>
          <div className="flex items-center gap-2 mb-2 bg-admin-ink/5 rounded-xl px-3 py-2">
            <span className="text-xs text-admin-ink/88 truncate flex-1">{payPageUrl}</span>
            <button
              onClick={handleCopyLink}
              className="shrink-0 text-xs text-blue-400 hover:underline"
            >
              Copy
            </button>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs text-admin-ink/80 mb-1" htmlFor="link-amount">
                Amount to pre-fill
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-admin-ink/72 text-sm">$</span>
                <input
                  id="link-amount"
                  value={linkAmount}
                  onChange={(e) => setLinkAmount(e.target.value)}
                  inputMode="decimal"
                  className="w-28 bg-admin-card border border-admin-ink/20 rounded-xl pl-6 pr-2 py-1.5 text-sm outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                />
              </div>
            </div>
            <button
              onClick={handleSaveDepositAmount}
              disabled={linkBusy || !linkAmountValid}
              className="py-1.5 px-3 rounded-xl border border-blue-400 text-blue-700 text-sm font-semibold hover:bg-blue-50 disabled:opacity-40"
            >
              {linkBusy ? "…" : record.paymentLinkAmount !== undefined ? "Update amount" : "Save deposit amount"}
            </button>
          </div>
          {!isInvoice && (
            <p className="mt-1.5 text-xs text-admin-ink/62">
              {depositAmount !== undefined
                ? `Defaults to this quote's ${depositPercent}% deposit (${money(depositAmount)}) — type a different amount for a custom deposit.`
                : "No deposit payment terms set on this quote — defaults to the full total. Type a smaller amount for a custom deposit."}
            </p>
          )}
          <p className="mt-1.5 text-xs text-admin-ink/62">
            This is always the same single link — it never changes. The amount above just
            pre-fills &quot;Amount to pay&quot; when the customer opens it (they can still change
            it up to the current balance); it&apos;s not a separate link for the deposit vs. the
            rest.
          </p>
          {!linkAmountValid && linkAmount !== "" && (
            <p className="mt-1 text-xs text-admin-accent">Enter an amount between $0.01 and {money(grandTotal)}.</p>
          )}
          {linkMessage && <p className="mt-1.5 text-xs text-green-700">{linkMessage}</p>}
        </div>

        {error && <p className="mt-3 text-sm text-admin-accent font-medium">{error}</p>}

        {balance > 0 ? (
          <div className="mt-4 border-t border-admin-ink/10 pt-4">
            <p className="text-xs font-medium text-admin-ink/80 uppercase tracking-wide mb-2">Record manual payment</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-admin-ink/80 mb-1" htmlFor="payment-amount">
                  Amount
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-admin-ink/72 text-sm">$</span>
                  <input
                    id="payment-amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    className="w-full bg-admin-card border border-admin-ink/20 rounded-xl pl-6 pr-2 py-1.5 text-sm outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-admin-ink/80 mb-1" htmlFor="payment-tender">
                  Paid via
                </label>
                <select
                  id="payment-tender"
                  value={tender}
                  onChange={(e) => setTender(e.target.value as InvoicePaymentEntry["tender"])}
                  className="w-full bg-admin-card border border-admin-ink/20 rounded-xl px-2 py-1.5 text-sm outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                >
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-xs text-admin-ink/80 mb-1" htmlFor="payment-note">
                Note (optional)
              </label>
              <input
                id="payment-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. deposit paid at pickup counter"
                className="w-full bg-admin-card border border-admin-ink/20 rounded-xl px-2 py-1.5 text-sm outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
              />
            </div>
            {!amountValid && amount !== "" && (
              <p className="mt-1 text-xs text-admin-accent">Enter an amount between $0.01 and {money(balance)}.</p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => submit(amountValid ? amountNum : 0)}
                disabled={busy || !amountValid}
                className="flex-1 py-2 rounded-xl bg-admin-bg text-admin-ink text-sm font-semibold hover:bg-admin-bg/90 disabled:opacity-40"
              >
                {busy ? "Saving…" : "Record payment"}
              </button>
              <button
                onClick={() => submit(balance)}
                disabled={busy}
                className="py-2 px-3 rounded-xl border border-green-600/30 text-green-700 text-sm font-semibold hover:bg-green-50 disabled:opacity-40"
              >
                Mark fully paid
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
            {isInvoice ? "This invoice is paid in full." : "This quote is fully paid."}
          </p>
        )}

        {payments.length > 0 && (
          <button
            onClick={handleResetToUnpaid}
            disabled={busy}
            className="mt-4 text-xs text-admin-ink/62 hover:text-admin-accent hover:underline disabled:opacity-40"
          >
            Reset to unpaid (clears all recorded payments)
          </button>
        )}
      </div>
    </div>
  );
}
