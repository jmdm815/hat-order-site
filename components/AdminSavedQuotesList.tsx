"use client";

import { useEffect, useState } from "react";
import { QuoteRecord, InvoicePaymentStatus } from "@/lib/quotes-store";

type Props = {
  // Bump this (e.g. a counter) whenever the parent knows the list is stale
  // (a save/update elsewhere) and this component should refetch.
  refreshToken: number;
  onEdit: (record: QuoteRecord) => void;
};

const STATUS_LABEL: Record<InvoicePaymentStatus, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid",
};

const STATUS_CLASS: Record<InvoicePaymentStatus, string> = {
  unpaid: "bg-red-100 text-red-700",
  partially_paid: "bg-amber-100 text-amber-800",
  paid: "bg-green-100 text-green-800",
};

async function downloadPdf(id: string, mode: string, fallbackName: string) {
  const res = await fetch(`/api/admin/quotes/${id}/pdf?mode=${mode}`);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="(.+)"/);
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Lists every quote/invoice saved from the Quote Builder (see
// lib/quotes-store.ts) so past quotes live on the site instead of only
// existing for as long as a browser tab stays open. Handles converting a
// quote to an invoice, toggling an invoice's payment status, downloading any
// PDF variant straight from the record's saved pricing snapshot, and
// deleting a record.
export default function AdminSavedQuotesList({ refreshToken, onEdit }: Props) {
  const [records, setRecords] = useState<QuoteRecord[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/quotes")
      .then((r) => r.json())
      .then((data: { quotes: QuoteRecord[]; persistent: boolean }) => {
        setRecords(data.quotes ?? []);
        setPersistent(data.persistent);
      })
      .catch(() => setError("Failed to load saved quotes."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [refreshToken]);

  async function handleConvert(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${id}/convert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to convert");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function handlePaymentStatus(id: string, invoiceStatus: InvoicePaymentStatus) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${id}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update payment status");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this saved quote/invoice? This can't be undone.")) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-navy/40 text-sm">Loading…</p>;
  }

  return (
    <div>
      {!persistent && (
        <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No durable storage is connected to this deployment yet, so saved quotes only last until the
          next cold start or redeploy. Connect a Vercel Blob store to this project (Vercel dashboard →
          Storage → Create Database → Blob → Connect to Project) to make them stick.
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {records.length === 0 ? (
        <p className="text-sm text-navy/40">No saved quotes yet — build one above and hit &quot;Save quote.&quot;</p>
      ) : (
        <div className="space-y-2">
          {records.map((r) => {
            const customer = r.computed.customerName || r.computed.customerCompany || "(no customer name)";
            const isBusy = busyId === r.id;
            return (
              <div
                key={r.id}
                className="border border-navy/10 rounded-xl bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-navy truncate">{customer}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.status === "invoice" ? "bg-navy/10 text-navy" : "bg-navy/5 text-navy/60"
                      }`}
                    >
                      {r.status === "invoice" ? r.invoiceNumber : "Quote"}
                    </span>
                    {r.status === "invoice" && r.invoiceStatus && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS[r.invoiceStatus]}`}>
                        {STATUS_LABEL[r.invoiceStatus]}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-navy/50 mt-0.5">
                    {r.computed.totalQuantity} units · ${r.computed.grandTotal.toFixed(2)} · saved{" "}
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onEdit(r)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-navy/20 hover:bg-navy/5"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => downloadPdf(r.id, "customer", "quote.pdf")}
                    className="text-xs px-2.5 py-1 rounded-lg border border-navy/20 hover:bg-navy/5"
                  >
                    PDF
                  </button>
                  <button
                    onClick={() => downloadPdf(r.id, "internal", "quote-internal.pdf")}
                    className="text-xs px-2.5 py-1 rounded-lg border border-red/30 text-red hover:bg-red/5"
                  >
                    Internal
                  </button>
                  <button
                    onClick={() => downloadPdf(r.id, "work-order", "work-order.pdf")}
                    className="text-xs px-2.5 py-1 rounded-lg border border-navy/20 hover:bg-navy/5"
                  >
                    Work order
                  </button>
                  {r.status === "quote" ? (
                    <button
                      onClick={() => handleConvert(r.id)}
                      disabled={isBusy}
                      className="text-xs px-2.5 py-1 rounded-lg bg-navy text-white hover:bg-navy/90 disabled:opacity-40"
                    >
                      {isBusy ? "…" : "Convert to invoice"}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => downloadPdf(r.id, "invoice", `${r.invoiceNumber}.pdf`)}
                        className="text-xs px-2.5 py-1 rounded-lg border border-green-600/30 text-green-700 hover:bg-green-50"
                      >
                        Invoice
                      </button>
                      {r.invoiceStatus !== "paid" && (
                        <button
                          onClick={() => handlePaymentStatus(r.id, "paid")}
                          disabled={isBusy}
                          className="text-xs px-2.5 py-1 rounded-lg bg-green-700 text-white hover:bg-green-800 disabled:opacity-40"
                        >
                          {isBusy ? "…" : "Mark paid"}
                        </button>
                      )}
                      {r.invoiceStatus !== "unpaid" && (
                        <button
                          onClick={() => handlePaymentStatus(r.id, "unpaid")}
                          disabled={isBusy}
                          className="text-xs px-2.5 py-1 rounded-lg border border-navy/20 hover:bg-navy/5 disabled:opacity-40"
                        >
                          Mark unpaid
                        </button>
                      )}
                      {r.invoiceStatus === "unpaid" && (
                        <button
                          onClick={() => handlePaymentStatus(r.id, "partially_paid")}
                          disabled={isBusy}
                          className="text-xs px-2.5 py-1 rounded-lg border border-amber-400 text-amber-800 hover:bg-amber-50 disabled:opacity-40"
                        >
                          Partial payment
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(r.id)}
                    disabled={isBusy}
                    className="text-xs px-2.5 py-1 text-red-600 hover:underline disabled:text-navy/20"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
