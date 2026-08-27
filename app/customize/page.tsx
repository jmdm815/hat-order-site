import { Suspense } from "react";
import StepHeader from "@/components/StepHeader";
import CustomizeForm from "@/components/CustomizeForm";

export default function CustomizePage() {
  return (
    <>
      <StepHeader />
      <main className="flex-1 max-w-[110rem] mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-navy">Customize your order</h1>
        <Suspense fallback={<p className="mt-10 text-navy/40 text-sm">Loading…</p>}>
          <CustomizeForm />
        </Suspense>
      </main>
    </>
  );
}
