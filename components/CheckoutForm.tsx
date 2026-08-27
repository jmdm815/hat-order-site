"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrder } from "@/lib/order-context";
import { CustomerInfo, PaymentMethodId } from "@/lib/types";
import { formatUSD } from "@/lib/pricing";
import SquarePaymentMethod from "./SquarePaymentMethod";

const PAYMENT_METHODS: { id: PaymentMethodId; label: string; blurb: string }[] = [
  { id: "card", label: "Credit / Debit Card", blurb: "Processed instantly via Square." },
  { id: "afterpay", label: "Afterpay", blurb: "Pay in 4 — processed via Square." },
  { id: "klarna", label: "Klarna", blurb: "Pay in 4 or pay later, via Klarna directly." },
  { id: "affirm", label: "Affirm", blurb: "Monthly financing, via Affirm directly." },
  { id: "zelle", label: "Zelle", blurb: "Bank transfer — confirmed manually, not automated." },
];

const emptyCustomer: CustomerInfo = {
  name: "",
  email: "",
  phone: "",
  company: "",
  shippingAddress1: "",
  shippingAddress2: "",
  city: "",
  state: "",
  zip: "",
  sameLogoBefore: false,
};

export default function CheckoutForm() {
  const router = useRouter();
  const { cart, cartSubtotal, cartSetupFees, cartTotal, customer, setCustomer } = useOrder();
  const [form, setForm] = useState<CustomerInfo>(customer ?? emptyCustomer);
  const [method, setMethod] = useState<PaymentMethodId>("card");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoConfirmed, setInfoConfirmed] = useState(false);

  const infoComplete =
    form.name && form.email && form.shippingAddress1 && form.city && form.state && form.zip;

  function updateField<K extends keyof CustomerInfo>(key: K, value: CustomerInfo[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submitOrder(squareSourceId?: string) {
    setSubmitting(true);
    setError(null);
    setCustomer(form);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart,
          customer: form,
          paymentMethod: method,
          subtotal: cartSubtotal,
          setupFees: cartSetupFees,
          total: cartTotal,
          squareSourceId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Checkout failed");
      // Carry the full order via sessionStorage instead of re-fetching it by
      // id — on a serverless deployment the confirmation page's request can
      // land on a different instance than the one that just saved it.
      try {
        window.sessionStorage.setItem(
          `order-${data.order.id}`,
          JSON.stringify(data.order)
        );
      } catch {
        // sessionStorage unavailable (private mode, etc.) — confirmation
        // page falls back to an API fetch, which still works locally.
      }
      router.push(`/confirmation?orderId=${data.order.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (cart.length === 0) {
    return (
      <p className="mt-10 text-navy/60">
        Your cart is empty — head back to the catalog to add a hat first.
      </p>
    );
  }

  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
      <div className="space-y-8">
        {/* Customer info */}
        <section className="border border-navy/10 rounded-xl bg-white p-5">
          <h2 className="font-semibold text-navy">Contact & shipping</h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full name" value={form.name} onChange={(v) => updateField("name", v)} />
            <Field label="Email" value={form.email} onChange={(v) => updateField("email", v)} type="email" />
            <Field label="Phone" value={form.phone} onChange={(v) => updateField("phone", v)} />
            <Field label="Company (optional)" value={form.company ?? ""} onChange={(v) => updateField("company", v)} />
            <Field
              label="Address"
              value={form.shippingAddress1}
              onChange={(v) => updateField("shippingAddress1", v)}
              className="sm:col-span-2"
            />
            <Field
              label="Apt / suite (optional)"
              value={form.shippingAddress2 ?? ""}
              onChange={(v) => updateField("shippingAddress2", v)}
              className="sm:col-span-2"
            />
            <Field label="City" value={form.city} onChange={(v) => updateField("city", v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="State" value={form.state} onChange={(v) => updateField("state", v)} />
              <Field label="ZIP" value={form.zip} onChange={(v) => updateField("zip", v)} />
            </div>
          </div>
        </section>

        {/* Payment method */}
        <section className="border border-navy/10 rounded-xl bg-white p-5">
          <h2 className="font-semibold text-navy">Payment method</h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={`text-left p-3 rounded-lg border transition ${
                  method === m.id
                    ? "border-red ring-1 ring-red"
                    : "border-navy/10 hover:border-red/40"
                }`}
              >
                <div className="font-medium text-sm text-navy">{m.label}</div>
                <div className="text-xs text-navy/60 mt-0.5">{m.blurb}</div>
              </button>
            ))}
          </div>

          {!infoConfirmed ? (
            <button
              disabled={!infoComplete}
              onClick={() => setInfoConfirmed(true)}
              className="mt-5 w-full py-3 rounded-full bg-navy text-white font-semibold hover:bg-red transition disabled:bg-navy/20 disabled:cursor-not-allowed"
            >
              Continue to Payment →
            </button>
          ) : (
            <div className="mt-5">
              {method === "card" && (
                <SquarePaymentMethod
                  method="card"
                  amount={cartTotal}
                  disabled={submitting}
                  onTokenized={(sourceId) => submitOrder(sourceId)}
                />
              )}
              {method === "afterpay" && (
                <SquarePaymentMethod
                  method="afterpay"
                  amount={cartTotal}
                  disabled={submitting}
                  onTokenized={(sourceId) => submitOrder(sourceId)}
                />
              )}
              {(method === "klarna" || method === "affirm") && (
                <div>
                  <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {method === "klarna" ? "Klarna" : "Affirm"} isn&apos;t wired to live credentials
                    in this prototype — clicking below simulates their hosted-checkout redirect and
                    approval so you can see the full flow. Real financing requires a{" "}
                    {method === "klarna" ? "Klarna" : "Affirm"} merchant account.
                  </div>
                  <button
                    onClick={() => submitOrder()}
                    disabled={submitting}
                    className="mt-4 w-full py-3 rounded-full bg-navy text-white font-semibold hover:bg-red transition disabled:bg-navy/20"
                  >
                    {submitting
                      ? "Processing…"
                      : `Continue with ${method === "klarna" ? "Klarna" : "Affirm"} (Demo)`}
                  </button>
                </div>
              )}
              {method === "zelle" && (
                <div>
                  <div className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                    Zelle can&apos;t be charged automatically from any website — it&apos;s
                    bank-to-bank only. Placing this order reserves it; you&apos;ll get Zelle
                    payment instructions on the confirmation page and we confirm manually once
                    received.
                  </div>
                  <button
                    onClick={() => submitOrder()}
                    disabled={submitting}
                    className="mt-4 w-full py-3 rounded-full bg-navy text-white font-semibold hover:bg-red transition disabled:bg-navy/20"
                  >
                    {submitting ? "Placing order…" : "Place Order — Pay via Zelle"}
                  </button>
                </div>
              )}
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>
          )}
        </section>
      </div>

      {/* Order summary */}
      <aside className="border border-navy/10 rounded-xl bg-white p-5 h-fit sticky top-24">
        <h2 className="font-semibold text-navy">Order summary</h2>
        <div className="mt-3 space-y-2 text-sm text-navy/70">
          {cart.map((l) => (
            <div key={l.id} className="flex justify-between">
              <span>
                {l.styleNumber}
                {l.size ? ` — ${l.size}` : ""} × {l.quantity}
              </span>
              <span>{formatUSD(l.lineTotal)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between font-semibold text-lg text-navy mt-3 pt-3 border-t border-navy/10">
          <span>Total</span>
          <span>{formatUSD(cartTotal)}</span>
        </div>
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs text-navy/60">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-navy/20 rounded-lg px-3 py-2 text-sm"
      />
    </label>
  );
}
