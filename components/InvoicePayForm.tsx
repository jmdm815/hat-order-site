"use client";

import { useEffect, useRef, useState } from "react";

// Minimal shape of the pieces of the Square Web Payments SDK this component
// uses (the SDK is loaded from Square's CDN at runtime and has no bundled
// types) — same minimal typing approach as components/SquarePaymentMethod.tsx.
type SquareCardInstance = {
  attach: (element: HTMLElement | null) => Promise<void>;
  destroy?: () => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string; errors?: { message: string }[] }>;
};
type SquarePayments = { card: () => Promise<SquareCardInstance> };
type SquareSdk = { payments: (appId: string, locationId: string) => SquarePayments };

// Not re-declaring `declare global { interface Window { Square?: ... } }`
// here — components/SquarePaymentMethod.tsx already augments the global
// Window type with its own (structurally identical but nominally distinct)
// SquareSdk alias, and TypeScript requires merged global declarations to
// share the exact same type, which two separately-defined aliases don't
// satisfy even when their shapes match. Reading window.Square through a
// local cast avoids that conflict without needing a shared types file.
function getSquareSdk(): SquareSdk | undefined {
  return (window as unknown as { Square?: SquareSdk }).Square;
}

const SQUARE_APP_ID = process.env.NEXT_PUBLIC_SQUARE_APP_ID;
const SQUARE_LOCATION_ID = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
const SQUARE_ENV = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "sandbox";
const SQUARE_CONFIGURED = Boolean(SQUARE_APP_ID && SQUARE_LOCATION_ID);

const SDK_SRC =
  SQUARE_ENV === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";

type Props = {
  amount: number; // dollars — the amount about to be charged
  disabled?: boolean;
  onPay: (sourceId: string) => Promise<void> | void;
};

// Card-only, direct-charge Square Web Payments SDK form for the public
// invoice pay page (app/pay/[id]) — collects card details inline (no
// redirect to a Square-hosted checkout page) and hands the resulting
// one-time token to the parent, which POSTs it to /api/pay/[id] to actually
// run the charge. Unlike components/SquarePaymentMethod.tsx (the storefront
// checkout's version), this has no "demo mode" fallback: this page is
// reached by real customers paying a real invoice, so if Square isn't
// configured it shows a plain unavailable message instead of a fake charge
// button that would mislead someone into thinking they'd paid.
export default function InvoicePayForm({ amount, disabled, onPay }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<SquareCardInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!SQUARE_CONFIGURED) return;
    let cancelled = false;

    async function init() {
      if (!getSquareSdk()) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = SDK_SRC;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load the payment form"));
          document.body.appendChild(script);
        });
      }
      const sdk = getSquareSdk();
      if (cancelled || !sdk) return;
      try {
        const payments = sdk.payments(SQUARE_APP_ID as string, SQUARE_LOCATION_ID as string);
        const card = await payments.card();
        await card.attach(containerRef.current);
        if (cancelled) {
          card.destroy?.();
          return;
        }
        cardRef.current = card;
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the payment form");
      }
    }

    init();
    return () => {
      cancelled = true;
      cardRef.current?.destroy?.();
      cardRef.current = null;
    };
  }, []);

  async function handleSubmit() {
    if (!cardRef.current || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await cardRef.current.tokenize();
      if (result.status === "OK" && result.token) {
        await onPay(result.token);
      } else {
        setError(result.errors?.[0]?.message ?? "Card was declined");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!SQUARE_CONFIGURED) {
    return (
      <p className="text-sm text-navy/70 bg-navy/5 border border-navy/10 rounded-lg px-4 py-3">
        Online payment isn&apos;t available right now — please contact us to arrange payment.
      </p>
    );
  }

  return (
    <div>
      <div ref={containerRef} className="min-h-[56px]" />
      {error && <p className="mt-2 text-sm text-red font-medium">{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={!ready || disabled || submitting || amount <= 0}
        className="mt-4 w-full py-3 rounded-lg bg-red text-white font-heading font-semibold hover:bg-red-dark transition disabled:opacity-40"
      >
        {submitting ? "Processing…" : `Pay $${amount.toFixed(2)}`}
      </button>
    </div>
  );
}
