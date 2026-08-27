import Link from "next/link";
import { isAdminAuthed, usingDefaultPassword } from "@/lib/admin-auth";
import AdminLogin from "@/components/AdminLogin";
import AdminDashboard from "@/components/AdminDashboard";

export default async function AdminPage() {
  const authed = await isAdminAuthed();

  return (
    <>
      <header className="border-b-2 border-navy bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="font-heading font-semibold text-lg tracking-wide text-navy uppercase">
            JM Digital Media · Admin
          </span>
          <Link href="/" className="text-sm text-navy/60 hover:text-navy hover:underline">
            ← Back to site
          </Link>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-navy">Admin</h1>
      {authed && usingDefaultPassword() && (
        <p className="mt-3 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
          You&apos;re using the default admin password. Set an{" "}
          <code className="font-mono">ADMIN_PASSWORD</code> environment
          variable on this Vercel project to change it.
        </p>
      )}
      <div className="mt-6">
        {authed ? <AdminDashboard /> : <AdminLogin />}
      </div>
      </main>
    </>
  );
}
