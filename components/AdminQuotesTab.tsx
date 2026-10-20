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

// Combines the Quote Builder with the list of saved quotes/invoices,
// coordinating the two: editing a saved record loads it into the builder
// (remounting it via `key` so its internal state starts fresh from that
// record — see AdminQuoteBuilder's Props comment), and any save/update/
// convert bumps `refreshToken` so the list re-fetches.
export default function AdminQuotesTab({ seed, onSeedConsumed }: Props) {
  const [editingRecord, setEditingRecord] = useState<QuoteRecord | null>(null);
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

  return (
    <div className="space-y-8">
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

      <section className="bg-navy/[0.02] border border-navy/10 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-navy mb-3">Saved quotes &amp; invoices</h3>
        <AdminSavedQuotesList
          refreshToken={refreshToken}
          onEdit={(record) => {
            setEditingRecord(record);
            if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </section>
    </div>
  );
}
