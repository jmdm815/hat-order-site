import { isAdminAuthed } from "@/lib/admin-auth";
import AdminLoginScreen from "@/components/AdminLoginScreen";
import AdminShell from "@/components/AdminShell";
import AdminCustomerPage from "@/components/AdminCustomerPage";

export const metadata = { title: "Customer · JM Digital Media" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return <AdminLoginScreen />;
  const { id } = await params;
  return (
    <AdminShell active="customers">
      <AdminCustomerPage customerId={id} />
    </AdminShell>
  );
}
