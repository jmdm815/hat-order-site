"use client";

import { useEffect, useState } from "react";
import { QuoteRecord, InvoicePaymentStatus } from "@/lib/quotes-store";
import AdminInvoicePaymentModal from "./AdminInvoicePaymentModal";
import AdminSendDocumentModal from "./AdminSendDocumentModal";

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

// Opens a blank tab synchronously (before the fetch's `await`) so the
// browser treats it as a direct result of the click and doesn't block it as
// a popup, then navigates that tab to the PDF once it's ready — matching the
// fix in components/AdminQuoteBuilder.tsx's downloadPdf. Opening the tab only
// after the await (or relying on an anchor's `download` attribute, which
// mobile Safari largely ignores) is what was navigating the admin's current
// tab away to view the PDF instead of leaving it open in a new one.
async function downloadPdf(id: string, mode: string) {
  const tab = window.open("", "_blank");
  try {
    const res = await fetch(`/api/admin/quotes/${id}/pdf?mode=${mode}`);
    if (!res.ok) {
      tab?.close();
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (tab) {
      tab.location.href = url;
    } else {
      window.open(url, "_blank");
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    tab?.close();
  }
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
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [paymentModalRecord, setPaymentModalRecord] = useState<QuoteRecord | null>(null);
  const [sendModalRecord, setSendModalRecord] = useState<QuoteRecord | null>(null);
  const [jobsMessage, setJobsMessage] = useState<string | null>(null);

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

  // Creates (or refreshes) a Square-hosted "Pay online" link for this
  // invoice's current total, then copies it to the clipboard so the admin
  // can drop it straight into an email/text — the link is also saved onto
  // the record (lib/quotes-store.ts) and appears on the invoice PDF itself.
  async function handlePaymentLink(id: string) {
    setBusyId(id);
    setError(null);
    setLinkMessage(null);
    try {
      const res = await fetch(`/api/admin/quotes/${id}/payment-link`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create payment link");
      const url: string | undefined = data.record?.paymentLinkUrl;
      if (url && navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => {});
        setLinkMessage("Payment link copied to clipboard.");
      } else {
        setLinkMessage(url ?? "Payment link created.");
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  // Copies this site's own branded invoice-payment page link
  // (app/pay/[id]/page.tsx) to the clipboard — no API call needed, since the
  // page is reached by the record's own id. The customer sees a JM Digital
  // Media-styled summary of their order and pays (in full or partially)
  // right there via Square's card form, with no redirect to a Square-hosted
  // checkout page — unlike the "Square checkout link" button below.
  function handleCopyPayPageLink(id: string) {
    const url = `${window.location.origin}/pay/${id}`;
    setLinkMessage(null);
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(url)
        .then(() => setLinkMessage("Pay page link copied to clipboard."))
        .catch(() => setLinkMessage(url));
    } else {
      setLinkMessage(url);
    }
  }

  // Creates a production job per line item not already sent (see
  // lib/jobs-store.ts's createJobsFromQuote) — safe to click more than once
  // on the same record, e.g. after adding more lines later.
  async function handleSendToJobs(id: string) {
    setBusyId(id);
    setError(null);
    setJobsMessage(null);
    try {
      const res = await fetch(`/api/admin/quotes/${id}/send-to-jobs`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send to jobs");
      const createdCount = data.created?.length ?? 0;
      setJobsMessage(
        createdCount === 0
          ? "Already sent — no new line items to add."
          : `Sent ${createdCount} item${createdCount === 1 ? "" : "s"} to Jobs.${data.skipped ? ` (${data.skipped} already there.)` : ""}`
      );
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
    return <p className="text-white/40 text-sm">Loading…</p>;
  }

  return (
    <div>
      {!persistent && (
        <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          No durable storage is connected to this deployment yet, so saved quotes only last until the
          next cold start or redeploy. Connect a Vercel Blob store to this project (Vercel dashboard →
          Storage → Create Database → Blob → Connect to Project) to make them stick.
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {linkMessage && <p className="mb-3 text-sm text-green-700">{linkMessage}</p>}
      {jobsMessage && <p className="mb-3 text-sm text-green-700">{jobsMessage}</p>}

      {records.length === 0 ? (
        <p className="text-sm text-white/40">No saved quotes yet — build one above and hit &quot;Save quote.&quot;</p>
      ) : (
        <div className="space-y-2">
          {records.map((r) => {
            const customer = r.computed.customerName || r.computed.customerCompany || "(no customer name)";
            const isBusy = busyId === r.id;
            return (
              <div
                key={r.id}
                className="border border-white/10 shadow-lg shadow-black/30 rounded-2xl bg-black p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-white truncate">{customer}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.status === "invoice" ? "bg-white/10 text-white" : "bg-white/5 text-white/60"
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
                  <div className="text-xs text-white/50 mt-0.5">
                    {r.computed.totalQuantity} units · ${r.computed.grandTotal.toFixed(2)} · saved{" "}
                    {new Date(r.updatedAt).toLocaleDateString()}
                    {r.status === "invoice" &&
                      typeof r.amountPaid === "number" &&
                      r.amountPaid > 0 &&
                      r.amountPaid < r.computed.grandTotal && (
                        <> · ${r.amountPaid.toFixed(2)} paid, ${(r.computed.grandTotal - r.amountPaid).toFixed(2)} remaining</>
                      )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onEdit(r)}
                    className="text-xs px-2.5 py-1 rounded-xl border border-white/20 hover:bg-white/5"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => downloadPdf(r.id, "customer")}
                    className="text-xs px-2.5 py-1 rounded-xl border border-white/20 hover:bg-white/5"
                  >
                    PDF
                  </button>
                  <button
                    onClick={() => downloadPdf(r.id, "internal")}
                    className="text-xs px-2.5 py-1 rounded-xl border border-red/30 text-red hover:bg-red/5"
                  >
                    Internal
                  </button>
                  <button
                    onClick={() => downloadPdf(r.id, "work-order")}
                    className="text-xs px-2.5 py-1 rounded-xl border border-white/20 hover:bg-white/5"
                  >
                    Work order
                  </button>
                  {r.status === "quote" ? (
                    <button
                      onClick={() => handleConvert(r.id)}
                      disabled={isBusy}
                      className="text-xs px-2.5 py-1 rounded-xl bg-navy text-white hover:bg-navy/90 disabled:opacity-40"
                    >
                      {isBusy ? "…" : "Convert to invoice"}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => downloadPdf(r.id, "invoice")}
                        className="text-xs px-2.5 py-1 rounded-xl border border-green-600/30 text-green-700 hover:bg-green-50"
                      >
                        Invoice
                      </button>
                      {r.invoiceStatus !== "paid" && (
                        <button
                          onClick={() => handleCopyPayPageLink(r.id)}
                          title="Copy a link to this site's own branded payment page for this invoice"
                          className="text-xs px-2.5 py-1 rounded-xl border border-red/30 text-red hover:bg-red/5"
                        >
                          Copy pay page link
                        </button>
                      )}
                      {r.invoiceStatus !== "paid" && (
                        <button
                          onClick={() => handlePaymentLink(r.id)}
                          disabled={isBusy}
                          title={
                            r.paymentLinkUrl
                              ? "Refresh and copy the Square-hosted checkout link"
                              : "Create a Square-hosted checkout link for the customer"
                          }
                          className="text-xs px-2.5 py-1 rounded-xl border border-blue-400 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                        >
                          {isBusy ? "…" : r.paymentLinkUrl ? "Copy Square link" : "Create Square link"}
                        </button>
                      )}
                      <button
                        onClick={() => setPaymentModalRecord(r)}
                        className={`text-xs px-2.5 py-1 rounded-xl font-medium ${
                          r.invoiceStatus === "paid"
                            ? "border border-green-600/30 text-green-700 hover:bg-green-50"
                            : "bg-navy text-white hover:bg-navy/90"
                        }`}
                      >
                        Payment
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setSendModalRecord(r)}
                    className="text-xs px-2.5 py-1 rounded-xl border border-white/20 hover:bg-white/5"
                  >
                    Send
                  </button>
                  <button
                    onClick={() => handleSendToJobs(r.id)}
                    disabled={isBusy}
                    title="Create a production job per line item, assigned to each item's decoration type"
                    className="text-xs px-2.5 py-1 rounded-xl border border-blue-400 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                  >
                    {isBusy ? "…" : "Send to Jobs"}
                  </button>
                  <button
                    onClick={() => handleDelete(r.id)}
                    disabled={isBusy}
                    className="text-xs px-2.5 py-1 text-red-600 hover:underline disabled:text-white/20"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {paymentModalRecord && (
        <AdminInvoicePaymentModal
          record={paymentModalRecord}
          onClose={() => setPaymentModalRecord(null)}
          onUpdated={(updated) => {
            setPaymentModalRecord(updated);
            setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
          }}
        />
      )}

      {sendModalRecord && (
        <AdminSendDocumentModal record={sendModalRecord} onClose={() => setSendModalRecord(null)} />
      )}
    </div>
  );
}
