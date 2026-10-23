"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminSavedQuotesList from "@/components/AdminSavedQuotesList";

// Creating or editing a quote now opens its own page
// (app/admin/quotes/new/page.tsx, app/admin/quotes/[id]/page.tsx) instead
// of a popup overlay — this tab is just the saved-quotes list plus a link
// to start a new one. "Edit" on a row navigates straight to that quote's
// page (see onEdit below). The list fetches fresh every time this tab
// mounts, which covers "just got back from saving a quote" automatically —
// leaving /admin/quotes/[id] and landing back on /admin remounts this
// whole tab, same as any other full page navigation.
export default function AdminQuotesTab() {
  const router = useRouter();

  return (
    <section className="bg-white/[0.02] border border-white/10 shadow-lg shadow-black/30 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-white">Saved quotes &amp; invoices</h3>
        <Link
          href="/admin/quotes/new"
          className="text-sm px-3 py-1.5 rounded-xl bg-red text-navy hover:bg-red/90 shrink-0"
        >
          + New quote
        </Link>
      </div>
      <AdminSavedQuotesList
        refreshToken={0}
        onEdit={(record) => router.push(`/admin/quotes/${record.id}`)}
      />
    </section>
  );
}
