"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminQuoteBuilder, { PendingLine } from "@/components/AdminQuoteBuilder";
import { QuoteRecord } from "@/lib/quotes-store";

// sessionStorage key the Quick Quote tab writes to right before navigating
// here with "Create quote" — see AdminDashboard's onCreateQuote handler.
// Read once on mount and cleared immediately, so it never reapplies on a
// later, unrelated visit to /admin/quotes/new.
const SEED_STORAGE_KEY = "admin-quote-seed";

type StoredSeed = { lines: PendingLine[]; setupChargeIds: string[] };

function readAndClearSeed(): StoredSeed | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SEED_STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(SEED_STORAGE_KEY);
    return JSON.parse(raw) as StoredSeed;
  } catch {
    return null;
  }
}

type Props = {
  // Present when editing a saved quote/invoice; absent for a brand-new one
  // (app/admin/quotes/new/page.tsx vs app/admin/quotes/[id]/page.tsx).
  quoteId?: string;
};

// Full-page quote builder — the quote builder used to live inside a popup
// overlay on the Quotes tab (components/AdminQuotesTab.tsx); it's now its
// own page per quote/invoice, like most editors in this admin, so creating
// or editing a quote gets a real URL, full-height layout, and no shared
// scroll position with the saved-quotes list.
export default function AdminQuotePageClient({ quoteId }: Props) {
  const router = useRouter();
  const [record, setRecord] = useState<QuoteRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(quoteId));
  const [notFound, setNotFound] = useState(false);
  const [seed] = useState<StoredSeed | null>(() => (quoteId ? null : readAndClearSeed()));

  useEffect(() => {
    if (!quoteId) return;
    let cancelled = false;
    fetch(`/api/admin/quotes/${quoteId}`)
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = await r.json();
        if (!cancelled) setRecord(data.record as QuoteRecord);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  const title = !quoteId
    ? "New quote"
    : record
      ? record.status === "invoice"
        ? `Editing invoice ${record.invoiceNumber}`
        : "Editing quote"
      : "Quote";

  return (
    <>
      <header className="border-b-2 border-white bg-black sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <span className="font-heading font-semibold text-sm sm:text-lg tracking-wide text-white uppercase truncate">
            JM Digital Media · Admin
          </span>
          <Link
            href="/admin?tab=quotes"
            className="shrink-0 text-sm text-white/60 hover:text-white hover:underline"
          >
            ← Back to quotes
          </Link>
        </div>
      </header>
      <main className="flex-1 max-w-5xl mx-auto px-4 py-6 sm:py-10 w-full">
        <h1 className="text-2xl font-bold text-white mb-6">{title}</h1>

        {loading && <p className="text-white/50 text-sm">Loading…</p>}

        {notFound && (
          <p className="text-sm text-red-500">
            That quote couldn&apos;t be found —{" "}
            <Link href="/admin?tab=quotes" className="underline">
              back to the saved quotes list
            </Link>
            .
          </p>
        )}

        {!loading && !notFound && (
          <AdminQuoteBuilder
            key={record?.id ?? "new"}
            initialRecord={record}
            initialLines={!record ? seed?.lines : undefined}
            initialSetupChargeIds={!record ? seed?.setupChargeIds : undefined}
            onSaved={(saved) => {
              setRecord(saved);
              if (!quoteId) {
                // Brand-new quote just got its first save — move the URL to
                // its real id so refreshing/sharing/bookmarking this page
                // keeps editing the same record instead of starting over.
                router.replace(`/admin/quotes/${saved.id}`);
              }
            }}
          />
        )}
      </main>
    </>
  );
}
