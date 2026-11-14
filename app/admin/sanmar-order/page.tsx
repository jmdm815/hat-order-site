import { isAdminAuthed } from "@/lib/admin-auth";
import AdminLoginScreen from "@/components/AdminLoginScreen";
import AdminShell, { AdminPageHeader } from "@/components/AdminShell";
import AdminSanmarOrder from "@/components/AdminSanmarOrder";

export const metadata = { title: "SanMar Order · JM Digital Media" };

export default async function Page() {
  if (!(await isAdminAuthed())) return <AdminLoginScreen />;
  return (
    <AdminShell active="sanmar-order">
      <AdminPageHeader title="SanMar Order" description="Order blanks for your quotes, check stock by warehouse, and send them to your sanmar.com shopping box." />
      <AdminSanmarOrder />
    </AdminShell>
  );
}
