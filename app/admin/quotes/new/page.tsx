import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/admin-auth";
import AdminQuotePageClient from "@/components/AdminQuotePageClient";

export default async function NewQuotePage() {
  if (!(await isAdminAuthed())) {
    redirect("/admin");
  }
  return <AdminQuotePageClient />;
}
