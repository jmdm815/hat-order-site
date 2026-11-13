import Link from "next/link";
import { isAdminAuthed, adminPasswordMissing } from "@/lib/admin-auth";
import AdminLogin from "@/components/AdminLogin";
import AdminDashboard from "@/components/AdminDashboard";

export default async function AdminPage() {
  const authed = await isAdminAuthed();

  return (
    <>
      <header className="border-b-2 border-admin-ink bg-admin-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <span className="font-heading font-semibold text-sm sm:text-lg tracking-wide text-admin-ink uppercase truncate">
            JM Digital Media · Admin
          </span>
          <div className="shrink-0 flex items-center gap-4">
            {authed && (
              <Link href="/admin/social" className="text-sm text-admin-ink/80 hover:text-admin-ink hover:underline">
                Social Studio
              </Link>
            )}
            {authed && (
              <Link href="/admin/sanmar-order" className="text-sm text-admin-ink/80 hover:text-admin-ink hover:underline">
                SanMar Order
              </Link>
            )}
            {authed && (
              <Link href="/admin/sewouts" className="text-sm text-admin-ink/80 hover:text-admin-ink hover:underline">
                Sewout Library
              </Link>
            )}
            <Link href="/" className="text-sm text-admin-ink/80 hover:text-admin-ink hover:underline">
              ← Back to site
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto px-4 py-6 sm:py-10 w-full">
        <h1 className="text-2xl font-bold text-admin-ink">Admin</h1>
      {adminPasswordMissing() && (
        <p className="mt-3 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 inline-block">
          Admin login is disabled. Set an{" "}
          <code className="font-mono">ADMIN_PASSWORD</code> environment
          variable on this Vercel project to enable it.
        </p>
      )}
      <div className="mt-6">
        {authed ? <AdminDashboard /> : <AdminLogin />}
      </div>
      </main>
    </>
  );
}
