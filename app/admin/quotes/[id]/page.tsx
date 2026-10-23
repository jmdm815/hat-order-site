import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/admin-auth";
import AdminQuotePageClient from "@/components/AdminQuotePageClient";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    redirect("/admin");
  }
  const { id } = await params;
  return <AdminQuotePageClient quoteId={id} />;
}
