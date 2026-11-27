import { isAdminAuthed } from "@/lib/admin-auth";
import AdminLoginScreen from "@/components/AdminLoginScreen";
import AdminShell, { AdminPageHeader } from "@/components/AdminShell";
import AdminConnector from "@/components/AdminConnector";

export const metadata = { title: "Claude Connector · JM Digital Media" };

export default async function Page() {
  if (!(await isAdminAuthed())) return <AdminLoginScreen />;
  return (
    <AdminShell active="connector">
      <AdminPageHeader
        title="Claude Connector"
        description="Lets Claude look up customers and build, save and email quotes in this admin, without signing in."
      />
      <AdminConnector />
    </AdminShell>
  );
}
