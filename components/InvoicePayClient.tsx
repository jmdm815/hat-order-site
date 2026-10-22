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
  miscFees: Array<{ label: string; amount: number }>;
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

  if (loading) {
    return <p className="text-navy/40 text-sm">Loading…</p>;
  }

  if (notFound || !invoice) {
    return (
      <div className="bg-white border border-navy/10 rounded-xl p-6">
        <h1 className="text-xl font-bold text-navy">Invoice not found</h1>
        <p className="mt-2 text-sm text-navy/60">
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
      <p className="text-xs font-medium text-navy/50 uppercase tracking-wide">
        {invoice.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : "Invoice"}
      </p>
      <h1 className="text-2xl font-bold text-navy mt-1">
        {invoice.customerCompany || invoice.customerName || "Your invoice"}
      </h1>
      {invoice.customerCompany && invoice.customerName && (
        <p className="text-sm text-navy/60">{invoice.customerName}</p>
      )}

      <div className="mt-6 bg-white border border-navy/10 rounded-xl overflow-hidden">
        <div className="divide-y divide-navy/5">
          {invoice.lines.map((line, i) => (
            <div key={i} className="px-4 py-3 flex items-start justify-between gap-4 text-sm">
              <div>
                <p className="font-medium text-navy">
                  {line.quantity} × {line.description}
                  {line.colorName ? ` — ${line.colorName}` : ""}
                </p>
                {line.decorationLabel && (
                  <p className="text-navy/50 text-xs mt-0.5">
                    {line.decorationLabel}
                    {line.priceColumnLabel ? ` (${line.priceColumnLabel})` : ""}
                  </p>
                )}
              </div>
              <p className="text-navy font-medium shrink-0">{money(line.subtotal)}</p>
            </div>
          ))}
          {invoice.setupCharges.map((charge) => (
            <div key={charge.id} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
              <p className="text-navy">{charge.label}</p>
              <p className="text-navy font-medium shrink-0">{money(charge.price)}</p>
            </div>
          ))}
          {invoice.miscFees.map((fee, i) => (
            <div key={i} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
              <p className="text-navy">{fee.label}</p>
              <p className="text-navy font-medium shrink-0">{money(fee.amount)}</p>
            </div>
          ))}
        </div>

        <div className="bg-navy/5 px-4 py-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-navy/70">Total</span>
            <span className="text-navy font-medium">{money(invoice.grandTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-navy/70">Paid</span>
            <span className="text-navy font-medium">{money(invoice.amountPaid)}</span>
          </div>
          <div className="flex justify-between pt-1.5 border-t border-navy/10">
            <span className="font-semibold text-navy">Balance</span>
            <span className={`font-bold ${paidInFull ? "text-green-700" : "text-red"}`}>
              {money(invoice.balance)}
            </span>
          </div>
        </div>
      </div>

      {successMessage && (
        <p className="mt-4 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          {successMessage}
        </p>
      )}

      {!paidInFull && (
        <div className="mt-6">
          <label className="block text-sm font-medium text-navy mb-1" htmlFor="pay-amount">
            Amount to pay
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/50">$</span>
              <input
                id="pay-amount"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                inputMode="decimal"
                className="w-full bg-white border border-navy/20 rounded-lg pl-7 pr-3 py-2 text-sm outline-none focus:border-red focus:ring-2 focus:ring-red/20"
              />
            </div>
            <button
              type="button"
              onClick={() => setAmountInput(invoice.balance.toFixed(2))}
              className="text-xs px-3 py-2 rounded-lg border border-navy/20 text-navy/70 hover:bg-navy/5 shrink-0"
            >
              Pay full balance ({money(invoice.balance)})
            </button>
          </div>
          {!amountValid && amountInput !== "" && (
            <p className="mt-1 text-xs text-red">Enter an amount between $0.01 and {money(invoice.balance)}.</p>
          )}

          <div className="mt-4">
            <label className="block text-sm font-medium text-navy mb-1" htmlFor="pay-email">
              Email for receipt <span className="font-normal text-navy/40">(optional)</span>
            </label>
            <input
              id="pay-email"
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-white border border-navy/20 rounded-lg px-3 py-2 text-sm outline-none focus:border-red focus:ring-2 focus:ring-red/20"
            />
            {emailInput.trim() !== "" && !EMAIL_RE.test(emailInput.trim()) && (
              <p className="mt-1 text-xs text-red">That doesn&apos;t look like a valid email address.</p>
            )}
            <p className="mt-1 text-xs text-navy/40">We&apos;ll email you a PDF receipt once payment goes through.</p>
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
