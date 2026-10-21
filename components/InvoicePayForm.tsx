"use client";

import { useEffect, useId, useRef, useState } from "react";

// Minimal shape of the pieces of the Square Web Payments SDK this component
// uses (the SDK is loaded from Square's CDN at runtime and has no bundled
// types) — same minimal typing approach as components/SquarePaymentMethod.tsx.
type SquareTokenizeResult = { status: string; token?: string; errors?: { message: string }[] };
type SquareCardInstance = {
  attach: (element: HTMLElement | null) => Promise<void>;
  destroy?: () => Promise<void>;
  tokenize: () => Promise<SquareTokenizeResult>;
};
// Shared by Apple Pay and Google Pay — both are "digital wallet" instances
// with the same tokenize() shape as the card instance. Google Pay also needs
// attach() (it renders Square/Google's own branded button); Apple Pay uses a
// custom button instead, so it never calls attach().
type SquareDigitalWalletInstance = {
  attach?: (element: HTMLElement | null) => Promise<void>;
  destroy?: () => Promise<void>;
  tokenize: () => Promise<SquareTokenizeResult>;
};
type SquarePaymentRequestOptions = {
  countryCode: string;
  currencyCode: string;
  total: { amount: string; label: string };
};
type SquarePaymentRequest = {
  update: (fields: { total: { amount: string; label: string } }) => boolean;
};
type SquarePayments = {
  card: () => Promise<SquareCardInstance>;
  paymentRequest: (options: SquarePaymentRequestOptions) => SquarePaymentRequest;
  applePay: (request: SquarePaymentRequest) => Promise<SquareDigitalWalletInstance>;
  googlePay: (request: SquarePaymentRequest) => Promise<SquareDigitalWalletInstance>;
};
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

// Card + Apple Pay + Google Pay, direct-charge Square Web Payments SDK form
// for the public invoice pay page (app/pay/[id]) — collects payment details
// inline (no redirect to a Square-hosted checkout page) and hands the
// resulting one-time token to the parent, which POSTs it to /api/pay/[id] to
// actually run the charge, whichever method produced it. Unlike
// components/SquarePaymentMethod.tsx (the storefront checkout's version),
// this has no "demo mode" fallback: this page is reached by real customers
// paying a real invoice, so if Square isn't configured it shows a plain
// unavailable message instead of a fake charge button that would mislead
// someone into thinking they'd paid.
export default function InvoicePayForm({ amount, disabled, onPay }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const googlePayContainerRef = useRef<HTMLDivElement>(null);
  const googlePayButtonId = useId().replace(/[:]/g, "");
  const cardRef = useRef<SquareCardInstance | null>(null);
  const applePayRef = useRef<SquareDigitalWalletInstance | null>(null);
  const googlePayRef = useRef<SquareDigitalWalletInstance | null>(null);
  const paymentRequestRef = useRef<SquarePaymentRequest | null>(null);
  const [ready, setReady] = useState(false);
  const [applePayReady, setApplePayReady] = useState(false);
  const [googlePayReady, setGooglePayReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // amount at mount time — the PaymentRequest is built once with this, then
  // kept in sync via the amount-change effect below rather than being
  // recreated (recreating it would mean re-initializing both wallets).
  const initialAmountRef = useRef(amount);

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

      const payments = sdk.payments(SQUARE_APP_ID as string, SQUARE_LOCATION_ID as string);

      // Card — required, so a failure here surfaces the existing error UI.
      try {
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
        return;
      }

      const paymentRequest = payments.paymentRequest({
        countryCode: "US",
        currencyCode: "USD",
        total: { amount: initialAmountRef.current.toFixed(2), label: "Total" },
      });
      paymentRequestRef.current = paymentRequest;

      // Apple Pay and Google Pay are optional extras — each is initialized
      // independently so one being unsupported (wrong browser, no wallet
      // set up, domain not registered, etc.) never blocks the other or the
      // required card flow above. Square's own docs note that rejecting
      // here IS the availability check; there's no separate "can I use
      // this" call to make first.
      try {
        const applePay = await payments.applePay(paymentRequest);
        if (cancelled) {
          applePay.destroy?.();
          return;
        }
        applePayRef.current = applePay;
        setApplePayReady(true);
      } catch {
        // Not available on this browser/device — leave the button hidden.
      }

      try {
        const googlePay = await payments.googlePay(paymentRequest);
        if (cancelled) {
          googlePay.destroy?.();
          return;
        }
        await googlePay.attach?.(googlePayContainerRef.current);
        if (cancelled) {
          googlePay.destroy?.();
          return;
        }
        googlePayRef.current = googlePay;
        setGooglePayReady(true);
      } catch {
        // Not available on this browser/device — leave the button hidden.
      }
    }

    init();
    return () => {
      cancelled = true;
      cardRef.current?.destroy?.();
      cardRef.current = null;
      applePayRef.current?.destroy?.();
      applePayRef.current = null;
      googlePayRef.current?.destroy?.();
      googlePayRef.current = null;
      paymentRequestRef.current = null;
    };
  }, []);

  // Keep the shared PaymentRequest's total in sync as the customer edits
  // "Amount to pay" on the pay page — update() can fail/return false while a
  // wallet sheet is actively open, which is harmless here (the sheet already
  // has the amount it opened with; the customer can just reopen it).
  useEffect(() => {
    if (!paymentRequestRef.current) return;
    try {
      paymentRequestRef.current.update({ total: { amount: amount.toFixed(2), label: "Total" } });
    } catch {
      // Ignore — see comment above.
    }
  }, [amount]);

  async function handleCardSubmit() {
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

  // Apple Pay requires tokenize() to be the first async step in the click
  // handler — no await before it — or Safari/iOS will refuse to show the
  // payment sheet. Keep this handler minimal for that reason.
  async function handleApplePayClick() {
    if (!applePayRef.current || submitting) return;
    setSubmitting(true);
    try {
      const result = await applePayRef.current.tokenize();
      setError(null);
      if (result.status === "OK" && result.token) {
        await onPay(result.token);
      } else {
        setError(result.errors?.[0]?.message ?? "Apple Pay payment was declined");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apple Pay payment failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGooglePayClick() {
    if (!googlePayRef.current || submitting) return;
    setSubmitting(true);
    try {
      const result = await googlePayRef.current.tokenize();
      setError(null);
      if (result.status === "OK" && result.token) {
        await onPay(result.token);
      } else {
        setError(result.errors?.[0]?.message ?? "Google Pay payment was declined");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google Pay payment failed");
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

  const walletsAvailable = applePayReady || googlePayReady;
  const canPay = amount > 0 && !disabled && !submitting;

  return (
    <div>
      {/* The Google Pay container has to exist in the DOM from first render
          so attach() (called once, during init) has something to render
          into — it's hidden with CSS, not left unmounted, until it's ready. */}
      <div className={walletsAvailable ? "mb-4 space-y-2" : "hidden"}>
        {applePayReady && (
          <button
            id="apple-pay-button"
            onClick={handleApplePayClick}
            disabled={!canPay}
            aria-label="Pay with Apple Pay"
            style={{ WebkitAppearance: "-apple-pay-button" }}
            className="w-full h-11 rounded-lg bg-black text-white text-sm font-medium disabled:opacity-40"
          >
            {/* Apple renders its own label/logo via -webkit-appearance
                above on supporting browsers; this text is the fallback
                shown anywhere that CSS value isn't recognized. */}
            Apple Pay
          </button>
        )}
        <div
          id={`google-pay-button-${googlePayButtonId}`}
          ref={googlePayContainerRef}
          onClick={handleGooglePayClick}
          className={googlePayReady ? "min-h-[48px]" : "hidden"}
        />
        <div className="flex items-center gap-2 pt-1">
          <div className="h-px flex-1 bg-navy/10" />
          <span className="text-xs text-navy/50">Or pay with card</span>
          <div className="h-px flex-1 bg-navy/10" />
        </div>
      </div>
      <div ref={containerRef} className="min-h-[56px]" />
      {error && <p className="mt-2 text-sm text-red font-medium">{error}</p>}
      <button
        onClick={handleCardSubmit}
        disabled={!ready || !canPay}
        className="mt-4 w-full py-3 rounded-lg bg-red text-white font-heading font-semibold hover:bg-red-dark transition disabled:opacity-40"
      >
        {submitting ? "Processing…" : `Pay $${amount.toFixed(2)}`}
      </button>
    </div>
  );
}
