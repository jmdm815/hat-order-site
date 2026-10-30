"use client";

import { useEffect, useState } from "react";
import { QuoteRecord, InvoicePaymentStatus, DELETED_RETENTION_DAYS } from "@/lib/quotes-store";
import AdminInvoicePaymentModal from "./AdminInvoicePaymentModal";
import AdminSendDocumentModal from "./AdminSendDocumentModal";
import AdminJobFolderModal from "./AdminJobFolderModal";

type View = "quotes" | "invoices" | "deleted";

type Props = {
  // Which slice of the store to show — a dedicated Quotes tab, a dedicated
  // Invoices tab, or the shared "Recently deleted" view (see
  // components/AdminQuotesTab.tsx). Quotes and invoices are separate,
  // linkable records (lib/quotes-store.ts) rather than one record that
  // flips status in place, so each tab only ever shows its own kind.
  view: View;
  // Bump this (e.g. a counter) whenever the parent knows the list is stale
  // (a save/update elsewhere) and this component should refetch.
  refreshToken: number;
  onEdit: (id: string) => void;
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

function daysLeft(deletedAt: string): number {
  const purgeAt = new Date(deletedAt).getTime() + DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

// Lists quotes, invoices, or recently-deleted records (see the `view` prop)
// from the Quote Builder (lib/quotes-store.ts). Handles converting a quote
// to a (new, linked) invoice — see convertQuoteToInvoice; there's no
// reverse conversion — toggling an invoice's payment status, downloading
// any PDF variant, and deleting (soft, with restore/permanent-delete in the
// "deleted" view).
export default function AdminSavedQuotesList({ view, refreshToken, onEdit }: Props) {
  const [records, setRecords] = useState<QuoteRecord[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [paymentModalRecord, setPaymentModalRecord] = useState<QuoteRecord | null>(null);
  const [sendModalRecord, setSendModalRecord] = useState<QuoteRecord | null>(null);
  const [jobFolderModalRecord, setJobFolderModalRecord] = useState<QuoteRecord | null>(null);
  const [jobsMessage, setJobsMessage] = useState<string | null>(null);
  // Which row's "Create a copy" quote-vs-invoice picker is open, if any —
  // see handleDuplicate below.
  const [copyMenuId, setCopyMenuId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    const url = view === "deleted" ? "/api/admin/quotes/deleted" : "/api/admin/quotes";
    fetch(url)
      .then((r) => r.json())
      .then((data: { quotes: QuoteRecord[]; persistent: boolean }) => {
        const all = data.quotes ?? [];
        setRecords(
          view === "deleted"
            ? all
            : all.filter((r) => r.status === (view === "invoices" ? "invoice" : "quote"))
        );
        setPersistent(data.persistent);
      })
      .catch(() => setError("Failed to load saved quotes."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // load() calls setLoading(true) synchronously so switching `view` (or a
    // refreshToken bump) shows the spinner immediately instead of flashing
    // the previous view's stale rows for one frame.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, view]);

  // Converts a quote into a (new, linked) invoice, or reuses the existing
  // one if this quote was already converted before — either way, jumps the
  // admin straight to that invoice's page, same as clicking Edit on it.
  async function handleConvert(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${id}/convert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to convert");
      onEdit(data.record.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  // Copies this site's own permanent, branded pay page link
  // (app/pay/[id]/page.tsx) to the clipboard — no API call needed, since the
  // page is reached by the record's own id. The customer sees a JM Digital
  // Media-styled summary of their order and pays (in full or partially)
  // right there via Square's card form, with no redirect to a Square-hosted
  // checkout page. Works the same for a plain quote's pre-invoice deposit
  // as for a converted invoice's balance — it's always the one single link,
  // which is also what the "Deposit"/"Payment" modal's "Save deposit
  // amount" action pre-fills with a saved amount.
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

  // Soft delete — moves the record into "Recently deleted" instead of
  // removing it outright. See handlePermanentDelete/handleRestore below for
  // the trash view's own actions.
  async function handleDelete(id: string) {
    if (!confirm(`Move this to Recently deleted? It'll be permanently deleted automatically after ${DELETED_RETENTION_DAYS} days, or you can delete it sooner from there.`)) return;
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

  // Creates an independent copy of this quote/invoice as a brand-new record
  // (lib/quotes-store.ts's duplicateQuote) — not a conversion, no link back
  // to this one — then jumps straight to editing the copy, same as Edit.
  // `kind` is whichever option the admin picked from the "Create a copy"
  // menu (see copyMenuId above).
  async function handleDuplicate(id: string, kind: "quote" | "invoice") {
    setCopyMenuId(null);
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create a copy");
      onEdit(data.record.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${id}/restore`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to restore");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function handlePermanentDelete(id: string) {
    if (!confirm("Permanently delete this? This can't be undone.")) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${id}/permanent-delete`, { method: "DELETE" });
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

  const emptyMessage =
    view === "deleted"
      ? "Nothing in Recently deleted."
      : view === "invoices"
        ? "No invoices yet — convert a quote, or create one directly above."
        : "No saved quotes yet — build one above and hit “Save quote.”";

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
        <p className="text-sm text-white/40">{emptyMessage}</p>
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
                      {r.status === "invoice" ? r.invoiceNumber : r.quoteNumber ?? "Quote"}
                    </span>
                    {r.status === "invoice" && r.invoiceStatus && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS[r.invoiceStatus]}`}>
                        {STATUS_LABEL[r.invoiceStatus]}
                      </span>
                    )}
                    {/* A plain quote (never converted to an invoice) has no
                        invoiceStatus field — that only exists on "invoice"
                        records — but it still tracks amountPaid/payments
                        whenever someone pays through its pay page before
                        conversion (e.g. paying the full amount up front
                        instead of a deposit). Without this, a fully- or
                        partially-paid quote showed no payment indicator
                        anywhere in this list. */}
                    {r.status === "quote" && (r.amountPaid ?? 0) > 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          r.amountPaid! >= r.computed.grandTotal - 0.005
                            ? STATUS_CLASS.paid
                            : STATUS_CLASS.partially_paid
                        }`}
                      >
                        {r.amountPaid! >= r.computed.grandTotal - 0.005
                          ? "Paid in full"
                          : `$${r.amountPaid!.toFixed(2)} paid`}
                      </span>
                    )}
                    {view !== "deleted" && r.status === "quote" && r.linkedInvoiceId && (
                      <button
                        onClick={() => onEdit(r.linkedInvoiceId!)}
                        className="px-2 py-0.5 rounded-full text-xs font-medium border border-white/20 text-white/70 hover:bg-white/5"
                        title="Open the invoice created from this quote"
                      >
                        → Invoice {r.linkedInvoiceNumber ?? ""}
                      </button>
                    )}
                    {view !== "deleted" && r.status === "invoice" && r.linkedQuoteId && (
                      <button
                        onClick={() => onEdit(r.linkedQuoteId!)}
                        className="px-2 py-0.5 rounded-full text-xs font-medium border border-white/20 text-white/70 hover:bg-white/5"
                        title="Open the quote this invoice was created from"
                      >
                        from Quote {r.linkedQuoteNumber ?? ""}
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-white/50 mt-0.5">
                    {r.computed.totalQuantity} units · ${r.computed.grandTotal.toFixed(2)} · saved{" "}
                    {new Date(r.updatedAt).toLocaleDateString()}
                    {typeof r.amountPaid === "number" &&
                      r.amountPaid > 0 &&
                      r.amountPaid < r.computed.grandTotal - 0.005 && (
                        <> · ${r.amountPaid.toFixed(2)} paid, ${(r.computed.grandTotal - r.amountPaid).toFixed(2)} remaining</>
                      )}
                    {view === "deleted" && r.deletedAt && (
                      <>
                        {" "}
                        · deleted {new Date(r.deletedAt).toLocaleDateString()} · auto-deletes in{" "}
                        {daysLeft(r.deletedAt)} day{daysLeft(r.deletedAt) === 1 ? "" : "s"}
                      </>
                    )}
                  </div>
                </div>

                {view === "deleted" ? (
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleRestore(r.id)}
                      disabled={isBusy}
                      className="text-xs px-2.5 py-1 rounded-xl bg-navy text-white hover:bg-navy/90 disabled:opacity-40"
                    >
                      {isBusy ? "…" : "Restore"}
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(r.id)}
                      disabled={isBusy}
                      className="text-xs px-2.5 py-1 rounded-xl border border-red-600/40 text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      Delete permanently
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onEdit(r.id)}
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
                    <button
                      onClick={() => setJobFolderModalRecord(r)}
                      title="Attach a garment mock-up and print-file locations, then download a 2-page job folder PDF"
                      className="text-xs px-2.5 py-1 rounded-xl border border-blue-400 text-blue-700 hover:bg-blue-50"
                    >
                      Job Folder
                    </button>
                    {copyMenuId === r.id ? (
                      <span className="inline-flex items-center gap-1.5 bg-white/5 rounded-xl px-1.5 py-0.5">
                        <span className="text-xs text-white/50 pl-1">Copy as:</span>
                        <button
                          onClick={() => handleDuplicate(r.id, "quote")}
                          disabled={isBusy}
                          className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40"
                        >
                          {isBusy ? "…" : "Quote"}
                        </button>
                        <button
                          onClick={() => handleDuplicate(r.id, "invoice")}
                          disabled={isBusy}
                          className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40"
                        >
                          {isBusy ? "…" : "Invoice"}
                        </button>
                        <button
                          onClick={() => setCopyMenuId(null)}
                          className="text-xs px-1.5 py-1 text-white/40 hover:text-white"
                          title="Cancel"
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setCopyMenuId(r.id)}
                        title="Create an independent copy of this as a new quote or invoice"
                        className="text-xs px-2.5 py-1 rounded-xl border border-white/20 hover:bg-white/5"
                      >
                        Create a copy
                      </button>
                    )}
                    {r.status === "quote" ? (
                      <>
                        <button
                          onClick={() => handleConvert(r.id)}
                          disabled={isBusy}
                          className="text-xs px-2.5 py-1 rounded-xl bg-navy text-white hover:bg-navy/90 disabled:opacity-40"
                        >
                          {isBusy ? "…" : r.linkedInvoiceId ? "View invoice" : "Convert to invoice"}
                        </button>
                        <button
                          onClick={() => setPaymentModalRecord(r)}
                          title="Set a deposit amount for the pay page link, or record a deposit taken another way (cash, check), before converting this to an invoice"
                          className={`text-xs px-2.5 py-1 rounded-xl font-medium ${
                            (r.amountPaid ?? 0) > 0
                              ? "border border-green-600/30 text-green-700 hover:bg-green-50"
                              : "border border-blue-400 text-blue-700 hover:bg-blue-50"
                          }`}
                        >
                          {(r.amountPaid ?? 0) >= r.computed.grandTotal - 0.005
                            ? `Paid ($${(r.amountPaid ?? 0).toFixed(2)})`
                            : (r.amountPaid ?? 0) > 0
                              ? `Deposit ($${(r.amountPaid ?? 0).toFixed(2)})`
                              : "Deposit"}
                        </button>
                        {(r.amountPaid ?? 0) < r.computed.grandTotal - 0.005 && (
                          <button
                            onClick={() => handleCopyPayPageLink(r.id)}
                            title="Copy a link to this site's own branded pay page for this quote's deposit"
                            className="text-xs px-2.5 py-1 rounded-xl border border-red/30 text-red hover:bg-red/5"
                          >
                            Copy pay page link
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {r.linkedQuoteId && (
                          <button
                            onClick={() => onEdit(r.linkedQuoteId!)}
                            className="text-xs px-2.5 py-1 rounded-xl border border-white/20 hover:bg-white/5"
                            title="Open the quote this invoice was created from"
                          >
                            View quote
                          </button>
                        )}
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
                )}
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

      {jobFolderModalRecord && (
        <AdminJobFolderModal
          record={jobFolderModalRecord}
          onClose={() => setJobFolderModalRecord(null)}
          onUpdated={(updated) => {
            setJobFolderModalRecord(updated);
            setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
          }}
        />
      )}
    </div>
  );
}
