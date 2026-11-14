import { isAdminAuthed } from "@/lib/admin-auth";
import AdminLoginScreen from "@/components/AdminLoginScreen";
import AdminShell, { AdminPageHeader } from "@/components/AdminShell";
import AdminSewoutLibrary from "@/components/AdminSewoutLibrary";

export const metadata = { title: "Sewout Library · JM Digital Media" };

export default async function Page() {
  if (!(await isAdminAuthed())) return <AdminLoginScreen />;
  return (
    <AdminShell active="sewouts">
      <AdminPageHeader title="Sewout Library" description="Your embroidery sewouts and logo files." />
      <AdminSewoutLibrary />
    </AdminShell>
  );
}
