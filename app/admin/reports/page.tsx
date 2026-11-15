import { isAdminAuthed } from "@/lib/admin-auth";
import AdminLoginScreen from "@/components/AdminLoginScreen";
import AdminShell, { AdminPageHeader } from "@/components/AdminShell";
import AdminReports from "@/components/AdminReports";

export const metadata = { title: "Reports · JM Digital Media" };

export default async function Page() {
  if (!(await isAdminAuthed())) return <AdminLoginScreen />;
  return (
    <AdminShell active="reports">
      <AdminPageHeader title="Reports" description="Sales tax and other numbers for your filings." />
      <AdminReports />
    </AdminShell>
  );
}
