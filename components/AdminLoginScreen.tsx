import AdminLogin from "@/components/AdminLogin";

// Signed-out view for every admin page: a centered card, no sidebar.
export default function AdminLoginScreen({ notice }: { notice?: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-screen grid place-items-center bg-admin-bg px-4 py-10">
      <div className="w-full max-w-sm bg-admin-card border border-admin-ink/10 rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-admin-accent text-admin-accent-ink text-sm font-bold">JM</span>
          <div>
            <p className="font-bold text-admin-ink leading-tight">JM Digital Media</p>
            <p className="text-sm text-admin-ink/60">Admin sign in</p>
          </div>
        </div>
        {notice}
        <AdminLogin />
      </div>
    </div>
  );
}
