import { isAdminAuthed } from "@/lib/admin-auth";
import AdminLoginScreen from "@/components/AdminLoginScreen";
import AdminShell, { AdminPageHeader } from "@/components/AdminShell";
import AdminSocialStudio from "@/components/AdminSocialStudio";

export const metadata = { title: "Social Studio · JM Digital Media" };

export default async function Page() {
  if (!(await isAdminAuthed())) return <AdminLoginScreen />;
  return (
    <AdminShell active="social">
      <AdminPageHeader title="Social Studio" description="Write captions and make images for your social media posts." />
      <AdminSocialStudio />
    </AdminShell>
  );
}
