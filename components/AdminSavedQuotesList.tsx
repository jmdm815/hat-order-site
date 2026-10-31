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
  // Which row's "⋯" actions menu (the thin ShopVox-style table row's
  // overflow menu) is open, if any. Only one at a time — opening a new one
  // implicitly closes the last, same as copyMenuId above.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

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

  // Closes the "⋯" actions menu (and its nested "Create a copy" picker) on
  // any click outside it — the menu itself and its toggle button call
  // stopPropagation so this only fires for genuine outside clicks.
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => {
      setOpenMenuId(null);
      setCopyMenuId(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenuId]);

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
    return <p className="text-admin-ink/62 text-sm">Loading…</p>;
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
        <p className="text-sm text-admin-ink/62">{emptyMessage}</p>
      ) : (
        <div className="border border-admin-ink/10 rounded-2xl bg-admin-card overflow-visible">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-admin-ink/50 border-b border-admin-ink/10">
                <th className="font-medium px-3 py-2 w-24">{view === "invoices" ? "Inv #" : "QT #"}</th>
                <th className="font-medium px-3 py-2">Customer</th>
                <th className="font-medium px-3 py-2 w-20 text-right">Units</th>
                <th className="font-medium px-3 py-2 w-28 text-right">Total</th>
                <th className="font-medium px-3 py-2 w-40">{view === "deleted" ? "Deleted" : "Status"}</th>
                <th className="font-medium px-3 py-2 w-28">Date</th>
                <th className="font-medium px-3 py-2 w-16 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => {
                const customer = r.computed.customerName || r.computed.customerCompany || "(no customer name)";
                const isBusy = busyId === r.id;
                const menuOpen = openMenuId === r.id;
                const paidInFull = (r.amountPaid ?? 0) >= r.computed.grandTotal - 0.005;
                const partiallyPaid = (r.amountPaid ?? 0) > 0 && !paidInFull;
                return (
                  <tr
                    key={r.id}
                    onClick={() => view !== "deleted" && onEdit(r.id)}
                    className={`border-b border-admin-ink/5 last:border-b-0 ${
                      i % 2 === 1 ? "bg-admin-ink/[0.025]" : ""
                    } ${view !== "deleted" ? "cursor-pointer hover:bg-admin-ink/[0.07]" : ""}`}
                  >
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      <span className="font-medium text-admin-ink/90">
                        {r.status === "invoice" ? r.invoiceNumber : r.quoteNumber ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top min-w-0">
                      <div className="truncate font-medium text-admin-ink">{customer}</div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        {view !== "deleted" && r.status === "quote" && r.linkedInvoiceId && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(r.linkedInvoiceId!);
                            }}
                            className="px-1.5 py-0.5 rounded-full text-[11px] font-medium border border-admin-ink/20 text-admin-ink/72 hover:bg-admin-ink/5"
                            title="Open the invoice created from this quote"
                          >
                            → Invoice {r.linkedInvoiceNumber ?? ""}
                          </button>
                        )}
                        {view !== "deleted" && r.status === "invoice" && r.linkedQuoteId && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(r.linkedQuoteId!);
                            }}
                            className="px-1.5 py-0.5 rounded-full text-[11px] font-medium border border-admin-ink/20 text-admin-ink/72 hover:bg-admin-ink/5"
                            title="Open the quote this invoice was created from"
                          >
                            from Quote {r.linkedQuoteNumber ?? ""}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-right text-admin-ink/72 whitespace-nowrap">
                      {r.computed.totalQuantity}
                    </td>
                    <td className="px-3 py-2 align-top text-right font-medium text-admin-ink whitespace-nowrap">
                      ${r.computed.grandTotal.toFixed(2)}
                      {partiallyPaid && (
                        <div className="text-[11px] font-normal text-admin-ink/55">
                          ${r.amountPaid!.toFixed(2)} paid
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {view === "deleted" && r.deletedAt ? (
                        <>
                          <div className="text-admin-ink/72">{new Date(r.deletedAt).toLocaleDateString()}</div>
                          <div className="text-[11px] text-admin-ink/50">
                            auto-deletes in {daysLeft(r.deletedAt)} day{daysLeft(r.deletedAt) === 1 ? "" : "s"}
                          </div>
                        </>
                      ) : r.status === "invoice" && r.invoiceStatus ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS[r.invoiceStatus]}`}>
                          {STATUS_LABEL[r.invoiceStatus]}
                        </span>
                      ) : r.status === "quote" && paidInFull ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS.paid}`}>
                          Paid in full
                        </span>
                      ) : r.status === "quote" && partiallyPaid ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS.partially_paid}`}>
                          Partially paid
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-admin-ink/8 text-admin-ink/65">
                          Draft
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-admin-ink/72 whitespace-nowrap">
                      {new Date(r.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 align-top text-right relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCopyMenuId(null);
                          setOpenMenuId(menuOpen ? null : r.id);
                        }}
                        className="text-admin-ink/60 hover:text-admin-ink hover:bg-admin-ink/10 rounded-lg w-7 h-7 inline-flex items-center justify-center text-base leading-none"
                        title="Actions"
                      >
                        ⋯
                      </button>

                      {menuOpen && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-3 top-full mt-1 z-20 w-56 rounded-xl border border-admin-ink/15 bg-admin-card shadow-2xl shadow-black/50 py-1 text-left"
                        >
                          {view === "deleted" ? (
                            <>
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  handleRestore(r.id);
                                }}
                                disabled={isBusy}
                                className="w-full text-left text-xs px-3 py-1.5 hover:bg-admin-ink/10 disabled:opacity-40"
                              >
                                {isBusy ? "…" : "Restore"}
                              </button>
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  handlePermanentDelete(r.id);
                                }}
                                disabled={isBusy}
                                className="w-full text-left text-xs px-3 py-1.5 text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                              >
                                Delete permanently
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  onEdit(r.id);
                                }}
                                className="w-full text-left text-xs px-3 py-1.5 hover:bg-admin-ink/10"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  downloadPdf(r.id, "customer");
                                }}
                                className="w-full text-left text-xs px-3 py-1.5 hover:bg-admin-ink/10"
                              >
                                PDF
                              </button>
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  downloadPdf(r.id, "internal");
                                }}
                                className="w-full text-left text-xs px-3 py-1.5 text-admin-accent hover:bg-admin-ink/10"
                              >
                                Internal (with cost)
                              </button>
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  downloadPdf(r.id, "work-order");
                                }}
                                className="w-full text-left text-xs px-3 py-1.5 hover:bg-admin-ink/10"
                              >
                                Work order
                              </button>
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setJobFolderModalRecord(r);
                                }}
                                title="Attach a garment mock-up and print-file locations, then download a 2-page job folder PDF"
                                className="w-full text-left text-xs px-3 py-1.5 text-blue-400 hover:bg-admin-ink/10"
                              >
                                Job Folder
                              </button>

                              <div className="my-1 border-t border-admin-ink/10" />

                              {copyMenuId === r.id ? (
                                <div className="px-3 py-1.5">
                                  <div className="text-[11px] text-admin-ink/55 mb-1">Copy as:</div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => handleDuplicate(r.id, "quote")}
                                      disabled={isBusy}
                                      className="text-xs px-2 py-1 rounded-lg bg-admin-ink/10 hover:bg-admin-ink/20 disabled:opacity-40"
                                    >
                                      {isBusy ? "…" : "Quote"}
                                    </button>
                                    <button
                                      onClick={() => handleDuplicate(r.id, "invoice")}
                                      disabled={isBusy}
                                      className="text-xs px-2 py-1 rounded-lg bg-admin-ink/10 hover:bg-admin-ink/20 disabled:opacity-40"
                                    >
                                      {isBusy ? "…" : "Invoice"}
                                    </button>
                                    <button
                                      onClick={() => setCopyMenuId(null)}
                                      className="text-xs px-1.5 py-1 text-admin-ink/62 hover:text-admin-ink"
                                      title="Cancel"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setCopyMenuId(r.id)}
                                  title="Create an independent copy of this as a new quote or invoice"
                                  className="w-full text-left text-xs px-3 py-1.5 hover:bg-admin-ink/10"
                                >
                                  Create a copy
                                </button>
                              )}

                              <div className="my-1 border-t border-admin-ink/10" />

                              {r.status === "quote" ? (
                                <>
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      handleConvert(r.id);
                                    }}
                                    disabled={isBusy}
                                    className="w-full text-left text-xs px-3 py-1.5 hover:bg-admin-ink/10 disabled:opacity-40"
                                  >
                                    {isBusy ? "…" : r.linkedInvoiceId ? "View invoice" : "Convert to invoice"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      setPaymentModalRecord(r);
                                    }}
                                    title="Set a deposit amount for the pay page link, or record a deposit taken another way (cash, check), before converting this to an invoice"
                                    className={`w-full text-left text-xs px-3 py-1.5 hover:bg-admin-ink/10 font-medium ${
                                      (r.amountPaid ?? 0) > 0 ? "text-green-400" : "text-blue-400"
                                    }`}
                                  >
                                    {paidInFull
                                      ? `Paid ($${(r.amountPaid ?? 0).toFixed(2)})`
                                      : partiallyPaid
                                        ? `Deposit ($${(r.amountPaid ?? 0).toFixed(2)})`
                                        : "Deposit"}
                                  </button>
                                  {!paidInFull && (
                                    <button
                                      onClick={() => {
                                        setOpenMenuId(null);
                                        handleCopyPayPageLink(r.id);
                                      }}
                                      title="Copy a link to this site's own branded pay page for this quote's deposit"
                                      className="w-full text-left text-xs px-3 py-1.5 text-admin-accent hover:bg-admin-ink/10"
                                    >
                                      Copy pay page link
                                    </button>
                                  )}
                                </>
                              ) : (
                                <>
                                  {r.linkedQuoteId && (
                                    <button
                                      onClick={() => {
                                        setOpenMenuId(null);
                                        onEdit(r.linkedQuoteId!);
                                      }}
                                      className="w-full text-left text-xs px-3 py-1.5 hover:bg-admin-ink/10"
                                      title="Open the quote this invoice was created from"
                                    >
                                      View quote
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      downloadPdf(r.id, "invoice");
                                    }}
                                    className="w-full text-left text-xs px-3 py-1.5 text-green-400 hover:bg-admin-ink/10"
                                  >
                                    Invoice
                                  </button>
                                  {r.invoiceStatus !== "paid" && (
                                    <button
                                      onClick={() => {
                                        setOpenMenuId(null);
                                        handleCopyPayPageLink(r.id);
                                      }}
                                      title="Copy a link to this site's own branded payment page for this invoice"
                                      className="w-full text-left text-xs px-3 py-1.5 text-admin-accent hover:bg-admin-ink/10"
                                    >
                                      Copy pay page link
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      setPaymentModalRecord(r);
                                    }}
                                    className="w-full text-left text-xs px-3 py-1.5 hover:bg-admin-ink/10"
                                  >
                                    Payment
                                  </button>
                                </>
                              )}

                              <div className="my-1 border-t border-admin-ink/10" />

                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setSendModalRecord(r);
                                }}
                                className="w-full text-left text-xs px-3 py-1.5 hover:bg-admin-ink/10"
                              >
                                Send
                              </button>
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  handleSendToJobs(r.id);
                                }}
                                disabled={isBusy}
                                title="Create a production job per line item, assigned to each item's decoration type"
                                className="w-full text-left text-xs px-3 py-1.5 text-blue-400 hover:bg-admin-ink/10 disabled:opacity-40"
                              >
                                {isBusy ? "…" : "Send to Jobs"}
                              </button>
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  handleDelete(r.id);
                                }}
                                disabled={isBusy}
                                className="w-full text-left text-xs px-3 py-1.5 text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
