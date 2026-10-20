import StepHeader from "@/components/StepHeader";
import InvoicePayClient from "@/components/InvoicePayClient";
import { getBrandSettings, publicLogoUrl } from "@/lib/pricing-store";

// Public, branded invoice payment page — see app/api/pay/[id]/route.ts for
// the full rationale (this complements, rather than replaces, the
// Square-hosted "Create payment link" button already in
// components/AdminSavedQuotesList.tsx). No admin auth here on purpose: this
// is the page a customer opens from a link/email/text.
export default async function PayInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrandSettings();
  return (
    <>
      <StepHeader logoUrl={publicLogoUrl(brand)} />
      <main className="flex-1 max-w-xl mx-auto px-4 py-10 w-full">
        <InvoicePayClient id={id} />
      </main>
    </>
  );
}
