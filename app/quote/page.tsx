import { Suspense } from "react";
import StepHeader from "@/components/StepHeader";
import QuoteEstimator from "@/components/QuoteEstimator";
import { DEFAULT_LOGO_URL, getBrandSettings } from "@/lib/pricing-store";

export default async function QuotePage() {
  const brand = await getBrandSettings();
  return (
    <>
      <StepHeader logoUrl={brand.logoUrl ?? DEFAULT_LOGO_URL} />
      <main className="flex-1 max-w-5xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-navy">Get a quote</h1>
        <p className="mt-1 text-navy/60 text-sm">
          Pick a color, decoration, and quantity to see pricing instantly — no artwork needed yet.
        </p>
        <div className="mt-8">
          <Suspense fallback={<p className="mt-10 text-navy/40 text-sm">Loading…</p>}>
            <QuoteEstimator />
          </Suspense>
        </div>
      </main>
    </>
  );
}
