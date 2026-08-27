import StepHeader from "@/components/StepHeader";
import CheckoutForm from "@/components/CheckoutForm";

export default function CheckoutPage() {
  return (
    <>
      <StepHeader />
      <main className="flex-1 max-w-5xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-navy">Checkout</h1>
        <CheckoutForm />
      </main>
    </>
  );
}
