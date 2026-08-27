"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useOrder } from "@/lib/order-context";
import { formatUSD } from "@/lib/pricing";

type OrderRecord = {
  id: string;
  status: string;
  total: number;
  paymentMethod: string;
  createdAt: string;
  customer: { name: string; email: string };
  cart: { id: string; styleNumber: string; size?: string; quantity: number; lineTotal: number }[];
  paymentReference?: string;
  notes?: string;
};

const STATUS_COPY: Record<string, { title: string; body: string }> = {
  paid: {
    title: "Payment received",
    body: "Your card was charged successfully via Square. We'll email a mockup for approval within 24 hours.",
  },
  demo_simulated: {
    title: "Order placed (demo mode)",
    body: "Square isn't connected to a live account yet, so this charge was simulated — nothing was actually billed.",
  },
  awaiting_bnpl_redirect: {
    title: "Order reserved",
    body: "In a live build this would redirect to your BNPL provider's hosted checkout to finish approval. That step is stubbed here.",
  },
  awaiting_zelle_confirmation: {
    title: "Order reserved — pay via Zelle",
    body: "Send the total below via Zelle using the order number as your memo. We confirm receipt manually and start production once it clears.",
  },
};

export default function ConfirmationDetails() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const { clearOrder } = useOrder();
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!orderId) return;
    // Prefer the copy CheckoutForm stashed right after placing the order —
    // reliable even on serverless hosts where the same-instance file lookup
    // below can miss. Fall back to the API (works for local/self-hosted runs,
    // or a direct reload where sessionStorage was cleared).
    try {
      const cached = window.sessionStorage.getItem(`order-${orderId}`);
      if (cached) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOrder(JSON.parse(cached));
        setLoading(false);
        return;
      }
    } catch {
      // fall through to API fetch
    }
    fetch(`/api/orders/${orderId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setOrder)
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => {
    // Clear local cart state once we've landed on a real confirmation.
    if (order) clearOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  if (!orderId) {
    return (
      <div className="mt-10 text-center">
        <p className="text-navy/60">No order to show.</p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 px-6 py-2.5 rounded-full bg-navy text-white font-medium"
        >
          Back to start
        </button>
      </div>
    );
  }

  if (loading) return <p className="mt-10 text-navy/40 text-sm">Loading your order…</p>;

  if (!order) {
    return <p className="mt-10 text-navy/60">We couldn&apos;t find that order.</p>;
  }

  const copy = STATUS_COPY[order.status] ?? STATUS_COPY.paid;

  return (
    <div className="mt-6">
      <div className="border border-navy/10 rounded-2xl bg-white p-6 sm:p-8">
        <div className="text-4xl">🎉</div>
        <h2 className="mt-3 text-xl font-bold text-navy">{copy.title}</h2>
        <p className="mt-1 text-navy/70">{copy.body}</p>

        <div className="mt-5 pt-5 border-t border-navy/10 grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-navy/60">Order number</span>
          <span className="text-right font-mono">{order.id.slice(0, 8).toUpperCase()}</span>
          <span className="text-navy/60">Payment method</span>
          <span className="text-right capitalize">{order.paymentMethod}</span>
          <span className="text-navy/60">Total</span>
          <span className="text-right font-semibold">{formatUSD(order.total)}</span>
          {order.paymentReference && (
            <>
              <span className="text-navy/60">Reference</span>
              <span className="text-right font-mono text-xs">{order.paymentReference}</span>
            </>
          )}
        </div>

        {order.status === "awaiting_zelle_confirmation" && (
          <div className="mt-5 p-4 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-900">
            <div className="font-semibold">Zelle payment instructions</div>
            <p className="mt-1">
              Send {formatUSD(order.total)} to <strong>payments@yourhatshop.com</strong> via
              Zelle. Use <strong>{order.id.slice(0, 8).toUpperCase()}</strong> as the memo so we
              can match it to your order.
            </p>
          </div>
        )}

        {order.notes && (
          <p className="mt-4 text-xs text-navy/40 italic">{order.notes}</p>
        )}
      </div>

      <Link
        href="/catalog"
        className="mt-6 inline-block px-6 py-2.5 rounded-full border border-navy/20 font-medium hover:bg-navy/5"
      >
        Start another order
      </Link>
    </div>
  );
}
