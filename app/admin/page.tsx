import { isAdminAuthed, adminPasswordMissing } from "@/lib/admin-auth";
import AdminLoginScreen from "@/components/AdminLoginScreen";
import AdminDashboard from "@/components/AdminDashboard";

export default async function AdminPage() {
  if (await isAdminAuthed()) return <AdminDashboard />;
  return (
    <AdminLoginScreen
      notice={
        adminPasswordMissing() ? (
          <p className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Admin login is disabled. Set an <code className="font-mono">ADMIN_PASSWORD</code> environment variable on
            this Vercel project to enable it.
          </p>
        ) : undefined
      }
    />
  );
}
