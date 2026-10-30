"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminSavedQuotesList from "@/components/AdminSavedQuotesList";

type Props = {
  // Quotes and invoices are separate, linkable records (see
  // lib/quotes-store.ts) shown in their own top-level admin tabs —
  // AdminDashboard renders this component twice, once per kind.
  kind: "quote" | "invoice";
};

// Creating or editing a quote/invoice now opens its own page
// (app/admin/quotes/new/page.tsx, app/admin/quotes/[id]/page.tsx) instead
// of a popup overlay — this tab is just the saved list plus a link to start
// a new one. "Edit" on a row navigates straight to that record's page (see
// onEdit below). The list fetches fresh every time this tab mounts, which
// covers "just got back from saving a quote" automatically — leaving
// /admin/quotes/[id] and landing back on /admin remounts this whole tab,
// same as any other full page navigation.
export default function AdminQuotesTab({ kind }: Props) {
  const router = useRouter();
  // "Recently deleted" is shared across both tabs (a soft-deleted record
  // keeps whatever kind it was, so toggling this from either tab shows the
  // same combined trash) rather than being its own third top-level tab —
  // it's a small escape hatch, not something the admin lives in day to day.
  const [showDeleted, setShowDeleted] = useState(false);

  return (
    <section className="bg-admin-ink/[0.02] border border-admin-ink/10 shadow-lg shadow-black/30 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-sm font-semibold text-admin-ink">
          {showDeleted ? "Recently deleted" : kind === "invoice" ? "Invoices" : "Quotes"}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDeleted((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-xl border border-admin-ink/20 text-admin-ink/88 hover:bg-admin-ink/5 shrink-0"
          >
            {showDeleted ? "← Back to list" : "Recently deleted"}
          </button>
          {!showDeleted && (
            <Link
              href={kind === "invoice" ? "/admin/quotes/new?kind=invoice" : "/admin/quotes/new"}
              className="text-sm px-3 py-1.5 rounded-xl bg-admin-accent text-admin-accent-ink hover:bg-admin-accent/90 shrink-0"
            >
              {kind === "invoice" ? "+ New invoice" : "+ New quote"}
            </Link>
          )}
        </div>
      </div>
      {showDeleted ? (
        <AdminSavedQuotesList
          view="deleted"
          refreshToken={0}
          onEdit={(id) => router.push(`/admin/quotes/${id}`)}
        />
      ) : (
        <AdminSavedQuotesList
          view={kind === "invoice" ? "invoices" : "quotes"}
          refreshToken={0}
          onEdit={(id) => router.push(`/admin/quotes/${id}`)}
        />
      )}
    </section>
  );
}
