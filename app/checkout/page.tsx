import StepHeader from "@/components/StepHeader";
import CheckoutForm from "@/components/CheckoutForm";
import { getBrandSettings, publicLogoUrl } from "@/lib/pricing-store";

export default async function CheckoutPage() {
  const brand = await getBrandSettings();
  return (
    <>
      <StepHeader logoUrl={publicLogoUrl(brand)} />
      <main className="flex-1 max-w-5xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-navy">Checkout</h1>
        <CheckoutForm />
      </main>
    </>
  );
}
