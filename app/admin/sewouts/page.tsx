import Link from "next/link";
import { isAdminAuthed } from "@/lib/admin-auth";
import AdminLogin from "@/components/AdminLogin";
import AdminSewoutLibrary from "@/components/AdminSewoutLibrary";

export const metadata = { title: "Sewout Library · JM Digital Media" };

export default async function SewoutsPage() {
  const authed = await isAdminAuthed();
  return (
    <>
      <header className="border-b-2 border-admin-ink bg-admin-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <span className="font-heading font-semibold text-sm sm:text-lg tracking-wide text-admin-ink uppercase truncate">
            Sewout Library
          </span>
          <Link href="/admin" className="shrink-0 text-sm text-admin-ink/80 hover:text-admin-ink hover:underline">
            ← Admin
          </Link>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto px-4 py-5 sm:py-8 w-full">
        {authed ? <AdminSewoutLibrary /> : <AdminLogin />}
      </main>
    </>
  );
}
