import { isAdminAuthed } from "@/lib/admin-auth";
import AdminLogin from "@/components/AdminLogin";
import MockupTestHarness from "@/components/MockupTestHarness";

// ---------------------------------------------------------------------------
// Internal-only smoke-test page for the Custom Hat Mockup Generator's
// rendering engines (phase 2). Not linked from any nav — reachable only by
// URL. Gated behind the same admin-password check as every other /admin/*
// page (see app/admin/page.tsx) so it isn't publicly reachable.
// ---------------------------------------------------------------------------

export default async function MockupTestPage() {
  const authed = await isAdminAuthed();

  return (
    <main className="flex-1 max-w-6xl mx-auto px-4 py-10 w-full">
      <h1 className="text-2xl font-bold text-navy">Mockup Render Test</h1>
      <p className="mt-1 text-sm text-navy/60">
        Internal smoke test for the mockup rendering engines. Not part of the
        customer-facing flow.
      </p>
      <div className="mt-6">{authed ? <MockupTestHarness /> : <AdminLogin />}</div>
    </main>
  );
}
