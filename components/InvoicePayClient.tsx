"use client";

import { useEffect, useState } from "react";
import InvoicePayForm, { InvoicePaymentMethod } from "./InvoicePayForm";

type InvoiceSummary = {
  id: string;
  invoiceNumber?: string;
  invoiceStatus?: string;
  customerName?: string;
  customerCompany?: string;
  customerEmail?: string;
  quoteDate: string;
  lines: Array<{
    description: string;
    colorName?: string;
    decorationLabel?: string;
    priceColumnLabel?: string;
    quantity: number;
    subtotal: number;
  }>;
  setupCharges: Array<{ id: string; label: string; price: number }>;
  miscFees: Array<{ label: string; amount: number; quantity: number; lineTotal: number }>;
  grandTotal: number;
  amountPaid: number;
  balance: number;
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Same loose check as the server (app/api/pay/[id]/route.ts) — just UI
// feedback, the server is the real gate on whether an email actually gets
// used.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Client half of the public invoice pay page (app/pay/[id]/page.tsx) — loads
// the invoice's customer-safe summary from /api/pay/[id], renders a
// shopVOX/competitor-style "Total / Paid / Balance" box plus an itemized
// breakdown so the customer sees roughly what they got on the invoice PDF,
// an editable "amount to pay" field (defaults to the full balance, but can
// be lowered for a deposit/partial payment), and the card form
// (InvoicePayForm) that actually runs the charge through Square.
export default function InvoicePayClient({ id }: { id: string }) {
  const [invoice, setInvoice] = useState<InvoiceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [receiptDownloading, setReceiptDownloading] = useState(false);
  const [receiptEmailInput, setReceiptEmailInput] = useState("");
  const [receiptSending, setReceiptSending] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptSentTo, setReceiptSentTo] = useState<string[]>([]);

  function load() {
    fetch(`/api/pay/${id}`)
      .then(async (r) => {
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((data: { invoice: InvoiceSummary } | null) => {
        if (data?.invoice) {
          setInvoice(data.invoice);
          setAmountInput(data.invoice.balance > 0 ? data.invoice.balance.toFixed(2) : "0.00");
          if (data.invoice.customerEmail) setEmailInput(data.invoice.customerEmail);
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
    const email = emailInput.trim();
    const emailValid = email !== "" && EMAIL_RE.test(email);
    try {
      const res = await fetch(`/api/pay/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, amount, method, email: emailValid ? email : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Payment failed");
      setInvoice(data.invoice);
      setAmountInput(data.invoice.balance > 0 ? data.invoice.balance.toFixed(2) : "0.00");
      const base =
        data.invoice.balance <= 0
          ? "Payment received — this invoice is now paid in full. Thank you!"
          : `Payment of ${money(amount)} received. Remaining balance: ${money(data.invoice.balance)}.`;
      setSuccessMessage(emailValid ? `${base} A receipt is on its way to ${email}.` : base);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    }
  }

  // Opens a blank tab synchronously (before the fetch's `await`) so the
  // browser treats it as a direct result of the click rather than blocking
  // it as a popup — same fix applied to the admin PDF buttons
  // (components/AdminQuoteBuilder.tsx's downloadPdf).
  async function downloadReceipt() {
    setReceiptDownloading(true);
    setReceiptError(null);
    const tab = window.open("", "_blank");
    try {
      const res = await fetch(`/api/pay/${id}/receipt-pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setReceiptError(data.error || "Failed to load the receipt");
        tab?.close();
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (tab) {
        tab.location.href = url;
      } else {
        window.open(url, "_blank");
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setReceiptError("Failed to load the receipt — check your connection and try again.");
      tab?.close();
    } finally {
      setReceiptDownloading(false);
    }
  }

  async function emailReceipt() {
    const email = receiptEmailInput.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      setReceiptError("Enter a valid email address.");
      return;
    }
    setReceiptSending(true);
    setReceiptError(null);
    try {
      const res = await fetch(`/api/pay/${id}/receipt-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send receipt");
      setReceiptSentTo((prev) => [...prev, email]);
      setReceiptEmailInput("");
    } catch (e) {
      setReceiptError(e instanceof Error ? e.message : "Failed to send receipt");
    } finally {
      setReceiptSending(false);
    }
  }

  if (loading) {
    return <p className="text-white/40 text-sm">Loading…</p>;
  }

  if (notFound || !invoice) {
    return (
      <div className="bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl p-6">
        <h1 className="text-xl font-bold text-white">Invoice not found</h1>
        <p className="mt-2 text-sm text-white/60">
          This payment link doesn&apos;t match an open invoice. If you think this is a mistake, please
          contact us.
        </p>
      </div>
    );
  }

  const paidInFull = invoice.balance <= 0;
  const amountNum = Number(amountInput);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= invoice.balance + 0.02;

  return (
    <div>
      <p className="text-xs font-medium text-white/50 uppercase tracking-wide">
        {invoice.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : "Invoice"}
      </p>
      <h1 className="text-2xl font-bold text-white mt-1">
        {invoice.customerCompany || invoice.customerName || "Your invoice"}
      </h1>
      {invoice.customerCompany && invoice.customerName && (
        <p className="text-sm text-white/60">{invoice.customerName}</p>
      )}

      <div className="mt-6 bg-black border border-white/10 shadow-lg shadow-black/30 rounded-2xl overflow-hidden">
        <div className="divide-y divide-white/5">
          {invoice.lines.map((line, i) => (
            <div key={i} className="px-4 py-3 flex items-start justify-between gap-4 text-sm">
              <div>
                <p className="font-medium text-white">
                  {line.quantity} × {line.description}
                  {line.colorName ? ` — ${line.colorName}` : ""}
                </p>
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
          <div className="flex justify-between">
            <span className="text-white/70">Total</span>
            <span className="text-white font-medium">{money(invoice.grandTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">Paid</span>
            <span className="text-white font-medium">{money(invoice.amountPaid)}</span>
          </div>
          <div className="flex justify-between pt-1.5 border-t border-white/10">
            <span className="font-semibold text-white">Balance</span>
            <span className={`font-bold ${paidInFull ? "text-green-700" : "text-red"}`}>
              {money(invoice.balance)}
            </span>
          </div>
        </div>
      </div>

      {successMessage && (
        <p className="mt-4 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          {successMessage}
        </p>
      )}

      {invoice.amountPaid > 0 && (
        <div className="mt-4 bg-black border border-white/10 rounded-2xl p-4">
          <p className="text-sm font-medium text-white">Get a PDF receipt</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={downloadReceipt}
              disabled={receiptDownloading}
              className="text-sm px-4 py-1.5 rounded-xl border border-white/20 text-white hover:bg-white/5 disabled:opacity-40"
            >
              {receiptDownloading ? "Loading…" : "Download receipt"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={receiptEmailInput}
              onChange={(e) => {
                setReceiptEmailInput(e.target.value);
                setReceiptError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  emailReceipt();
                }
              }}
              placeholder="you@example.com"
              className="flex-1 min-w-[200px] bg-black border border-white/20 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-red focus:ring-2 focus:ring-red/20"
            />
            <button
              type="button"
              onClick={emailReceipt}
              disabled={receiptSending}
              className="shrink-0 text-sm px-4 py-1.5 rounded-xl bg-white text-navy hover:bg-white/90 disabled:opacity-40"
            >
              {receiptSending ? "Sending…" : "Email receipt"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-white/40">
            Enter one address at a time — add more after each send.
          </p>

          {receiptError && <p className="mt-2 text-xs text-red font-medium">{receiptError}</p>}
          {receiptSentTo.length > 0 && (
            <p className="mt-2 text-xs text-green-700">
              Receipt sent to {receiptSentTo.join(", ")}.
            </p>
          )}
        </div>
      )}

      {!paidInFull && (
        <div className="mt-6">
          <label className="block text-sm font-medium text-white mb-1" htmlFor="pay-amount">
            Amount to pay
          </label>
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

          <div className="mt-4">
            <label className="block text-sm font-medium text-white mb-1" htmlFor="pay-email">
              Email for receipt <span className="font-normal text-white/40">(optional)</span>
            </label>
            <input
              id="pay-email"
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-black border border-white/20 rounded-xl px-3 py-2 text-sm outline-none focus:border-red focus:ring-2 focus:ring-red/20"
            />
            {emailInput.trim() !== "" && !EMAIL_RE.test(emailInput.trim()) && (
              <p className="mt-1 text-xs text-red">That doesn&apos;t look like a valid email address.</p>
            )}
            <p className="mt-1 text-xs text-white/40">We&apos;ll email you a PDF receipt once payment goes through.</p>
          </div>

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
