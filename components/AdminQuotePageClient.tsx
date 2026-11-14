"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import AdminQuoteBuilder, { PendingLine } from "@/components/AdminQuoteBuilder";
import AdminInvoicePaymentModal from "@/components/AdminInvoicePaymentModal";
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
  // Brand-new record only (ignored once a record loads): whether the first
  // save creates a plain quote (the default) or an invoice directly — set
  // from ?kind=invoice by the "+ New invoice" button on the Invoices tab.
  createAs?: "quote" | "invoice";
  initialCustomerId?: string;
  initialContactId?: string;
};

// Full-page quote builder — the quote builder used to live inside a popup
// overlay on the Quotes tab (components/AdminQuotesTab.tsx); it's now its
// own page per quote/invoice, like most editors in this admin, so creating
// or editing a quote gets a real URL, full-height layout, and no shared
// scroll position with the saved-quotes list.
export default function AdminQuotePageClient({ quoteId, createAs = "quote", initialCustomerId, initialContactId }: Props) {
  const router = useRouter();
  const [record, setRecord] = useState<QuoteRecord | null>(null);
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);
  const recordIdForOwner = record?.id;
  const recordCustomerKey = record ? `${record.input.customerId ?? ""}|${record.input.customerEmail ?? ""}|${record.input.customerName ?? ""}` : "";
  useEffect(() => {
    if (!recordIdForOwner) return;
    let alive = true;
    fetch(`/api/admin/customers/owner?recordId=${recordIdForOwner}`)
      .then((r) => r.json())
      .then((j) => alive && setOwner(j.customer ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [recordIdForOwner, recordCustomerKey]);
  const [loading, setLoading] = useState(Boolean(quoteId));
  const [notFound, setNotFound] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
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
    ? createAs === "invoice"
      ? "New invoice"
      : "New quote"
    : record
      ? record.status === "invoice"
        ? `Editing invoice ${record.invoiceNumber}`
        : "Editing quote"
      : "Quote";

  return (
    <>
      <AdminShell active={(record ? record.status === "invoice" : createAs === "invoice") ? "invoices" : "quotes"}>
        <Link
          href={(record ? record.status === "invoice" : createAs === "invoice") ? "/admin?tab=invoices" : "/admin?tab=quotes"}
          className="inline-block mb-3 text-sm text-admin-ink/60 hover:text-admin-ink"
        >
          {(record ? record.status === "invoice" : createAs === "invoice") ? "← All invoices" : "← All quotes"}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl sm:text-[28px] font-bold text-admin-ink leading-tight">{title}</h1>
            {owner && (
              <Link href={`/admin/customers/${owner.id}`} className="text-sm text-admin-ink/70 underline hover:text-admin-ink">
                {owner.name} · customer page →
              </Link>
            )}
          </div>
          {record && (
            <button
              onClick={() => setPaymentOpen(true)}
              title="Record a payment taken outside this site (ShopVox, cash, check, Zelle…) or see payment history"
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-semibold border ${
                (record.amountPaid ?? 0) >= record.computed.grandTotal - 0.005 && (record.amountPaid ?? 0) > 0
                  ? "border-green-600/40 text-green-700"
                  : "border-admin-accent text-admin-accent hover:bg-admin-accent/10"
              }`}
            >
              {(record.amountPaid ?? 0) >= record.computed.grandTotal - 0.005 && (record.amountPaid ?? 0) > 0
                ? `Paid $${(record.amountPaid ?? 0).toFixed(2)}`
                : (record.amountPaid ?? 0) > 0
                  ? `Payments ($${(record.amountPaid ?? 0).toFixed(2)} paid)`
                  : "Record payment"}
            </button>
          )}
        </div>

        {loading && <p className="text-admin-ink/72 text-sm">Loading…</p>}

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
            createAs={createAs}
            initialCustomerId={initialCustomerId}
            initialContactId={initialContactId}
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
      </AdminShell>
      {paymentOpen && record && (
        <AdminInvoicePaymentModal
          record={record}
          onClose={() => setPaymentOpen(false)}
          onUpdated={(updated) => setRecord(updated)}
        />
      )}
    </>
  );
}
