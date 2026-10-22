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

// Popup opened from the "Payment" button in AdminSavedQuotesList.tsx —
// replaces the old flat "Mark paid / Mark unpaid / Partial payment" button
// row with one place that shows the full picture (total, paid, balance,
// payment terms, payment history) and lets the admin manually record a real
// payment (e.g. "$40 cash") instead of only flipping a status flag. Calls
// app/api/admin/quotes/[id]/record-payment/route.ts, which shares
// lib/quotes-store.ts's recordInvoicePayment() with the real Square card
// charges collected through the customer-facing /pay/[id] page, so
// amountPaid/invoiceStatus stay consistent no matter how the money came in.
export default function AdminInvoicePaymentModal({ record, onClose, onUpdated }: Props) {
  const grandTotal = record.computed.grandTotal;
  const amountPaid = record.amountPaid ?? 0;
  const balance = Math.max(0, Math.round((grandTotal - amountPaid) * 100) / 100);
  const depositPercent = record.computed.depositPercent;
  const depositAmount =
    depositPercent && depositPercent < 100 ? Math.round(grandTotal * (depositPercent / 100) * 100) / 100 : undefined;

  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : "0.00");
  const [tender, setTender] = useState<InvoicePaymentEntry["tender"]>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= balance + 0.02;

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
    if (!confirm("Clear every recorded payment on this invoice and reset it to unpaid?")) return;
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

  const payments = record.payments ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-navy/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-black rounded-xl shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Payment</h2>
            <p className="text-xs text-white/50">{record.invoiceNumber ?? "Invoice"}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-sm px-1">
            ✕
          </button>
        </div>

        <div className="mt-4 bg-white/5 rounded-lg px-3 py-2.5 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-white/70">Total</span>
            <span className="font-medium text-white">{money(grandTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">Paid</span>
            <span className="font-medium text-white">{money(amountPaid)}</span>
          </div>
          <div className="flex justify-between pt-1 border-t border-white/10">
            <span className="font-semibold text-white">Balance</span>
            <span className={`font-bold ${balance <= 0 ? "text-green-700" : "text-red"}`}>{money(balance)}</span>
          </div>
          {depositAmount !== undefined && (
            <p className="text-xs text-white/50 pt-1">
              Payment terms: {depositPercent}% deposit ({money(depositAmount)}), balance due at pickup
            </p>
          )}
        </div>

        {payments.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-white/60 uppercase tracking-wide mb-1.5">Payment history</p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between items-baseline text-xs text-white/70">
                  <span>
                    {new Date(p.createdAt).toLocaleDateString()} —{" "}
                    {p.method === "square_card" ? "Card" : TENDER_LABEL[p.tender ?? "other"]}
                    {p.note ? ` (${p.note})` : ""}
                  </span>
                  <span className="font-medium shrink-0 ml-2">{money(p.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red font-medium">{error}</p>}

        {balance > 0 ? (
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="text-xs font-medium text-white/60 uppercase tracking-wide mb-2">Record manual payment</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-white/60 mb-1" htmlFor="payment-amount">
                  Amount
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 text-sm">$</span>
                  <input
                    id="payment-amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    className="w-full bg-black border border-white/20 rounded-lg pl-6 pr-2 py-1.5 text-sm outline-none focus:border-red focus:ring-2 focus:ring-red/20"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1" htmlFor="payment-tender">
                  Paid via
                </label>
                <select
                  id="payment-tender"
                  value={tender}
                  onChange={(e) => setTender(e.target.value as InvoicePaymentEntry["tender"])}
                  className="w-full bg-black border border-white/20 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-red focus:ring-2 focus:ring-red/20"
                >
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-xs text-white/60 mb-1" htmlFor="payment-note">
                Note (optional)
              </label>
              <input
                id="payment-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. deposit paid at pickup counter"
                className="w-full bg-black border border-white/20 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-red focus:ring-2 focus:ring-red/20"
              />
            </div>
            {!amountValid && amount !== "" && (
              <p className="mt-1 text-xs text-red">Enter an amount between $0.01 and {money(balance)}.</p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => submit(amountValid ? amountNum : 0)}
                disabled={busy || !amountValid}
                className="flex-1 py-2 rounded-lg bg-navy text-white text-sm font-semibold hover:bg-navy/90 disabled:opacity-40"
              >
                {busy ? "Saving…" : "Record payment"}
              </button>
              <button
                onClick={() => submit(balance)}
                disabled={busy}
                className="py-2 px-3 rounded-lg border border-green-600/30 text-green-700 text-sm font-semibold hover:bg-green-50 disabled:opacity-40"
              >
                Mark fully paid
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            This invoice is paid in full.
          </p>
        )}

        {payments.length > 0 && (
          <button
            onClick={handleResetToUnpaid}
            disabled={busy}
            className="mt-4 text-xs text-white/40 hover:text-red hover:underline disabled:opacity-40"
          >
            Reset to unpaid (clears all recorded payments)
          </button>
        )}
      </div>
    </div>
  );
}
