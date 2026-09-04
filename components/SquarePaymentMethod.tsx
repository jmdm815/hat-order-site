"use client";

import { useEffect, useRef, useState } from "react";

// Minimal shape of the pieces of the Square Web Payments SDK this component
// uses (the SDK is loaded from Square's CDN at runtime and has no bundled
// types). See https://developer.squareup.com/reference/sdks/web/payments
type SquarePaymentMethodInstance = {
  attach: (element: HTMLElement | null) => Promise<void>;
  destroy?: () => Promise<void>;
  tokenize: () => Promise<{
    status: string;
    token?: string;
    errors?: { message: string }[];
  }>;
};
type SquarePayments = {
  card: () => Promise<SquarePaymentMethodInstance>;
  afterpayClearpay: (options: {
    countryCode: string;
    amount: string;
    currency: string;
  }) => Promise<SquarePaymentMethodInstance>;
};
type SquareSdk = {
  payments: (appId: string, locationId: string) => SquarePayments;
};

declare global {
  interface Window {
    Square?: SquareSdk;
  }
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
  method: "card" | "afterpay";
  amount: number; // dollars
  onTokenized: (sourceId: string) => void;
  disabled?: boolean;
};

// Real Square Web Payments SDK integration when NEXT_PUBLIC_SQUARE_APP_ID /
// NEXT_PUBLIC_SQUARE_LOCATION_ID are set. Falls back to a clearly-labeled
// demo form so the checkout flow is always clickable in this prototype.
export default function SquarePaymentMethod({ method, amount, onTokenized, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paymentMethodRef = useRef<SquarePaymentMethodInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!SQUARE_CONFIGURED) return;
    let cancelled = false;

    async function init() {
      if (!window.Square) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = SDK_SRC;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load Square SDK"));
          document.body.appendChild(script);
        });
      }
      if (cancelled || !window.Square) return;

      try {
        const payments = window.Square.payments(SQUARE_APP_ID as string, SQUARE_LOCATION_ID as string);
        let pm: SquarePaymentMethodInstance;
        if (method === "card") {
          pm = await payments.card();
          await pm.attach(containerRef.current);
        } else {
          pm = await payments.afterpayClearpay({
            countryCode: "US",
            amount: amount.toFixed(2),
            currency: "USD",
          });
          await pm.attach(containerRef.current);
        }
        paymentMethodRef.current = pm;
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load Square payment form");
      }
    }

    init();
    return () => {
      cancelled = true;
      paymentMethodRef.current?.destroy?.();
    };
  }, [method, amount]);

  async function handleRealSubmit() {
    if (!paymentMethodRef.current) return;
    const result = await paymentMethodRef.current.tokenize();
    if (result.status === "OK" && result.token) {
      onTokenized(result.token);
    } else {
      setError(result.errors?.[0]?.message ?? "Card was declined");
    }
  }

  if (!SQUARE_CONFIGURED) {
    return <DemoPaymentForm method={method} onSubmit={onTokenized} disabled={disabled} />;
  }

  return (
    <div>
      <div ref={containerRef} className="min-h-[56px]" />
      {error && <p className="mt-2 text-sm text-red font-medium">{error}</p>}
      <button
        onClick={handleRealSubmit}
        disabled={!ready || disabled}
        className="mt-4 w-full py-3 rounded-md bg-red text-white font-heading font-semibold hover:bg-red-dark transition disabled:bg-navy/20"
      >
        {method === "card" ? "Pay with Card" : "Pay with Afterpay"}
      </button>
    </div>
  );
}

function DemoPaymentForm({
  method,
  onSubmit,
  disabled,
}: {
  method: "card" | "afterpay";
  onSubmit: (sourceId: string) => void;
  disabled?: boolean;
}) {
  const [card, setCard] = useState("4111 1111 1111 1111");
  return (
    <div>
      <div className="text-xs font-medium text-navy bg-tan/30 border border-tan rounded-lg px-3 py-2">
        Demo mode — Square keys aren&apos;t configured yet, so this simulates a{" "}
        {method === "card" ? "card" : "Afterpay"} charge instead of processing a real one. Add
        NEXT_PUBLIC_SQUARE_APP_ID / SQUARE_ACCESS_TOKEN to go live.
      </div>
      {method === "card" && (
        <input
          value={card}
          onChange={(e) => setCard(e.target.value)}
          className="mt-3 w-full bg-white border border-navy/30 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-red focus:ring-2 focus:ring-red/20"
          placeholder="Card number"
        />
      )}
      <button
        onClick={() => onSubmit(`demo-${method}-source`)}
        disabled={disabled}
        className="mt-4 w-full py-3 rounded-md bg-red text-white font-heading font-semibold hover:bg-red-dark transition disabled:bg-navy/20"
      >
        {method === "card" ? "Pay with Card (Demo)" : "Pay with Afterpay (Demo)"}
      </button>
    </div>
  );
}
