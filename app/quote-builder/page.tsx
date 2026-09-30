import StepHeader from "@/components/StepHeader";
import QuoteBuilderWizard from "@/components/QuoteBuilderWizard";
import { DEFAULT_LOGO_URL, getBrandSettings } from "@/lib/pricing-store";

export default async function QuoteBuilderPage() {
  const brand = await getBrandSettings();
  return (
    <>
      <StepHeader logoUrl={brand.logoUrl ?? DEFAULT_LOGO_URL} />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-navy">Build a quote</h1>
        <p className="mt-1 text-navy/60 text-sm">
          Pick a decoration method, then a garment, then see live pricing for your quantity — no
          artwork needed yet.
        </p>
        <div className="mt-8">
          <QuoteBuilderWizard />
        </div>
      </main>
    </>
  );
}
