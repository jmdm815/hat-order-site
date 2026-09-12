"use client";

import { useState } from "react";
import AdminQuoteBuilder from "@/components/AdminQuoteBuilder";
import AdminSavedQuotesList from "@/components/AdminSavedQuotesList";
import { QuoteRecord } from "@/lib/quotes-store";

// Combines the Quote Builder with the list of saved quotes/invoices,
// coordinating the two: editing a saved record loads it into the builder
// (remounting it via `key` so its internal state starts fresh from that
// record — see AdminQuoteBuilder's Props comment), and any save/update/
// convert bumps `refreshToken` so the list re-fetches.
export default function AdminQuotesTab() {
  const [editingRecord, setEditingRecord] = useState<QuoteRecord | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  function bumpRefresh() {
    setRefreshToken((n) => n + 1);
  }

  return (
    <div className="space-y-8">
      <AdminQuoteBuilder
        key={editingRecord?.id ?? "new"}
        initialRecord={editingRecord}
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
