import { Suspense } from "react";
import StepHeader from "@/components/StepHeader";
import ConfirmationDetails from "@/components/ConfirmationDetails";

export default function ConfirmationPage() {
  return (
    <>
      <StepHeader />
      <main className="flex-1 max-w-2xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-navy">Order confirmation</h1>
        <Suspense fallback={<p className="mt-10 text-navy/40 text-sm">Loading…</p>}>
          <ConfirmationDetails />
        </Suspense>
      </main>
    </>
  );
}
