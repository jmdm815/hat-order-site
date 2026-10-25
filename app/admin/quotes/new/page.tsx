import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/admin-auth";
import AdminQuotePageClient from "@/components/AdminQuotePageClient";

// ?kind=invoice (set by the "+ New invoice" button on the Invoices tab,
// vs. the default "+ New quote" on the Quotes tab) starts this brand-new
// record as an invoice instead of a quote — see AdminQuoteBuilder's
// `createAs` prop and lib/quotes-store.ts's createInvoice.
export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  if (!(await isAdminAuthed())) {
    redirect("/admin");
  }
  const { kind } = await searchParams;
  return <AdminQuotePageClient createAs={kind === "invoice" ? "invoice" : "quote"} />;
}
