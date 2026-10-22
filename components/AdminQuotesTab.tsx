"use client";

import { useEffect, useState } from "react";
import AdminQuoteBuilder, { PendingLine } from "@/components/AdminQuoteBuilder";
import AdminSavedQuotesList from "@/components/AdminSavedQuotesList";
import { QuoteRecord } from "@/lib/quotes-store";

export type QuoteBuilderSeed = { token: number; lines: PendingLine[]; setupChargeIds: string[] };

type Props = {
  // Carried over from the Quick Quote tab's "Create quote" button (see
  // AdminDashboard) — a brand-new, unsaved builder gets seeded with these
  // lines/setup charges once, then onSeedConsumed clears it so a later,
  // unrelated visit to this tab doesn't keep reapplying it.
  seed?: QuoteBuilderSeed | null;
  onSeedConsumed?: () => void;
};

// Combines the Quote Builder with the list of saved quotes/invoices. The
// builder itself opens as its own popup overlay — rather than living inline,
// stacked directly above the "Saved quotes & invoices" list — so creating or
// editing one quote never shares scroll position with that list: "New
// quote" (or "Edit" on a saved row) opens the popup; closing it returns to
// the list, which is refreshed on any save/update/convert.
export default function AdminQuotesTab({ seed, onSeedConsumed }: Props) {
  const [editingRecord, setEditingRecord] = useState<QuoteRecord | null>(null);
  // A seed arriving from the Quick Quote tab means "open the builder right
  // away with these items already in it" — decided once, from this
  // component's very first render, rather than via a setState-in-effect.
  const [builderOpen, setBuilderOpen] = useState(() => Boolean(seed));
  const [refreshToken, setRefreshToken] = useState(0);

  // Consume the seed (if any) once, right when this tab mounts — AdminDashboard
  // only re-renders this component when its tab is active, so "on mount" here
  // really does mean "this one visit."
  useEffect(() => {
    if (seed) onSeedConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function bumpRefresh() {
    setRefreshToken((n) => n + 1);
  }

  function openNewQuote() {
    setEditingRecord(null);
    setBuilderOpen(true);
  }

  function closeBuilder() {
    setBuilderOpen(false);
  }

  return (
    <div className="space-y-8">
      <section className="bg-navy/[0.02] border border-navy/10 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-navy">Saved quotes &amp; invoices</h3>
          <button
            onClick={openNewQuote}
            className="text-sm px-3 py-1.5 rounded-lg bg-red text-white hover:bg-red/90 shrink-0"
          >
            + New quote
          </button>
        </div>
        <AdminSavedQuotesList
          refreshToken={refreshToken}
          onEdit={(record) => {
            setEditingRecord(record);
            setBuilderOpen(true);
          }}
        />
      </section>

      {/* Quote builder popup — only mounted while open, so each open/close
          starts the builder fresh (no leftover state from a previous
          session) without needing key tricks for the "brand new quote"
          case. The backdrop-click-to-close + stopPropagation pattern
          matches AdminInvoicePaymentModal.tsx's existing popup. */}
      {builderOpen && (
        <div
          className="fixed inset-0 z-50 bg-navy/40 flex items-start justify-center p-4 overflow-y-auto"
          onClick={closeBuilder}
        >
          <div
            className="bg-navy/[0.03] rounded-xl shadow-xl w-full max-w-5xl my-6 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <h2 className="text-lg font-bold text-navy">
                {editingRecord
                  ? editingRecord.status === "invoice"
                    ? `Editing invoice ${editingRecord.invoiceNumber}`
                    : "Editing quote"
                  : "New quote"}
              </h2>
              <button
                onClick={closeBuilder}
                className="text-xs px-3 py-1.5 rounded-lg border border-navy/20 bg-white hover:bg-navy/5 shrink-0"
              >
                ✕ Close
              </button>
            </div>

            <AdminQuoteBuilder
              key={editingRecord?.id ?? (seed ? `seed-${seed.token}` : "new")}
              initialRecord={editingRecord}
              initialLines={!editingRecord ? seed?.lines : undefined}
              initialSetupChargeIds={!editingRecord ? seed?.setupChargeIds : undefined}
              onSaved={(record) => {
                setEditingRecord(record);
                bumpRefresh();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
