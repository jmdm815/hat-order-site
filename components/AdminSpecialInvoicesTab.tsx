"use client";

import { useEffect, useMemo, useState } from "react";

// Special invoices: reseller copies of a normal invoice (e.g. Amazing
// T-Shirts). Same items, with the reseller's commission % taken off the
// decoration price only. See lib/special-invoices-store.ts.

type Summary = { originalTotal: number; decorationTotal: number; commissionAmount: number; netTotal: number };
type SizeRow = { size: string; quantity: number; garmentUnitPrice: number; decorationUnitPrice: number; unitPrice: number; lineTotal: number };
type Line = { styleNumber: string; productName: string; colorName: string; decorationLabel?: string; priceColumnLabel?: string; optional?: boolean; sizes: SizeRow[]; subtotal: number };
type Computed = { customerName?: string; customerCompany?: string; grandTotal: number; lines: Line[] };
type SpecialInvoice = {
  id: string;
  number: string;
  date: string;
  sourceId: string;
  sourceNumber?: string;
  commissionPercent: number;
  showCommissionNote: boolean;
  status: "unpaid" | "paid";
  terms?: "due-on-receipt" | "source";
  notes?: string;
  source: Computed;
  summary: Summary;
  updatedAt: string;
};
type QuoteRec = {
  id: string;
  status?: string;
  quoteNumber?: string;
  invoiceNumber?: string;
  createdAt?: string;
  computed: { customerName?: string; customerCompany?: string; grandTotal: number };
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inputCls = "mt-1 w-full border border-admin-ink/20 rounded-xl px-2 py-1.5 text-sm bg-admin-card";
const btn = "text-xs px-2 py-1 rounded-lg bg-admin-ink/10 hover:bg-admin-ink/20";

export default function AdminSpecialInvoicesTab() {
  const [invoices, setInvoices] = useState<SpecialInvoice[]>([]);
  const [records, setRecords] = useState<QuoteRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [newPct, setNewPct] = useState<number | "">(30);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ invoice: SpecialInvoice; computed: Computed } | null>(null);
  const [pct, setPct] = useState<number | "">(30);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/special-invoices", { cache: "no-store" });
      setInvoices((await res.json()).invoices ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    fetch("/api/admin/quotes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRecords((d.quotes ?? d ?? []) as QuoteRec[]))
      .catch(() => {});
  }, []);

  async function openInvoice(id: string) {
    setOpenId(id);
    setError("");
    setMsg("");
    const res = await fetch(`/api/admin/special-invoices/${id}`, { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) return setError(d.error || "Couldn't load it");
    setDetail(d);
    setPct(d.invoice.commissionPercent);
    setNotes(d.invoice.notes ?? "");
  }

  const choices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records
      .filter((r) => r.invoiceNumber || r.quoteNumber)
      .filter((r) =>
        !q ||
        [r.invoiceNumber, r.quoteNumber, r.computed?.customerName, r.computed?.customerCompany].some((v) => v?.toLowerCase().includes(q))
      )
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, 50);
  }, [records, search]);

  async function create() {
    if (!sourceId) return setError("Pick the invoice to copy");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/special-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, commissionPercent: newPct === "" ? 0 : newPct }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Create failed");
      setCreating(false);
      setSourceId("");
      await load();
      await openInvoice(d.invoice.id);
      setMsg(`Created ${d.invoice.number}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function update(patch: Record<string, unknown>, done?: string) {
    if (!openId) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/admin/special-invoices/${openId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed");
      await Promise.all([load(), openInvoice(openId)]);
      if (done) setMsg(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(si: SpecialInvoice) {
    if (!window.confirm(`Delete special invoice ${si.number}? The original ${si.sourceNumber ?? "invoice"} is not affected.`)) return;
    await fetch(`/api/admin/special-invoices/${si.id}`, { method: "DELETE" });
    if (openId === si.id) {
      setOpenId(null);
      setDetail(null);
    }
    await load();
  }

  const inv = detail?.invoice;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-admin-card border border-admin-ink/10 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-admin-ink/10">
          <h2 className="font-semibold text-admin-ink">Special invoices</h2>
          <button onClick={() => { setCreating((c) => !c); setError(""); }} className="px-3 py-1.5 rounded-xl text-sm font-semibold bg-admin-accent text-white hover:opacity-90">
            + New special invoice
          </button>
        </div>

        {creating && (
          <div className="p-4 border-b border-admin-ink/10 grid gap-3 sm:grid-cols-[1fr_1fr_120px_auto] items-end">
            <label className="block text-xs text-admin-ink/80">Search invoices / quotes
              <input className={inputCls} placeholder="Amazing, INV-0022…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label className="block text-xs text-admin-ink/80">Copy from
              <select className={inputCls} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                <option value="">— Pick one —</option>
                {choices.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.invoiceNumber ?? r.quoteNumber} · {r.computed?.customerCompany || r.computed?.customerName} · {money(r.computed?.grandTotal ?? 0)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-admin-ink/80">Commission % (off decoration)
              <input className={inputCls} type="number" min={0} max={100} step="0.5" value={newPct} onChange={(e) => setNewPct(e.target.value === "" ? "" : Number(e.target.value))} />
            </label>
            <button onClick={create} disabled={busy} className="px-3 py-2 rounded-xl text-sm font-semibold bg-admin-accent text-white hover:opacity-90 disabled:opacity-50">
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        )}

        {loading ? (
          <p className="px-4 py-6 text-sm text-admin-ink/60">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="px-4 py-6 text-sm text-admin-ink/60">No special invoices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="text-left text-xs text-admin-ink/60">
                <tr>
                  <th className="px-4 py-2">Invoice #</th>
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-4 py-2">From</th>
                  <th className="px-4 py-2 text-right">Original</th>
                  <th className="px-4 py-2 text-right">Commission</th>
                  <th className="px-4 py-2 text-right">They owe</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((si) => (
                  <tr key={si.id} className={`border-t border-admin-ink/10 ${si.id === openId ? "bg-admin-ink/5" : ""}`}>
                    <td className="px-4 py-2.5 font-semibold">
                      <button onClick={() => openInvoice(si.id)} className="text-admin-accent hover:underline">{si.number}</button>
                    </td>
                    <td className="px-4 py-2.5">{si.source.customerCompany || si.source.customerName}</td>
                    <td className="px-4 py-2.5 text-admin-ink/70">{si.sourceNumber ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">{money(si.summary.originalTotal)}</td>
                    <td className="px-4 py-2.5 text-right text-admin-ink/70">−{money(si.summary.commissionAmount)} ({si.commissionPercent}%)</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{money(si.summary.netTotal)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${si.status === "paid" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{si.status}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right space-x-2">
                      <a href={`/api/admin/special-invoices/${si.id}/pdf`} target="_blank" rel="noreferrer" className={btn}>PDF</a>
                      <button onClick={() => remove(si)} className="text-xs px-2 py-1 rounded-lg text-red-700 hover:bg-red-50">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!openId && error && <p className="px-4 pb-3 text-sm text-red-700">{error}</p>}
      </div>

      {openId && inv && detail && (
        <div className="rounded-2xl bg-admin-card border border-admin-ink/10 p-4 sm:p-5 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-admin-ink">
              {inv.number} <span className="font-normal text-admin-ink/60">· copy of {inv.sourceNumber ?? "invoice"} · {inv.source.customerCompany || inv.source.customerName}</span>
            </h2>
            <button onClick={() => { setOpenId(null); setDetail(null); }} className={btn}>Close</button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ["Original total", money(inv.summary.originalTotal)],
              ["Decoration", money(inv.summary.decorationTotal)],
              [`Commission (${inv.commissionPercent}%)`, `−${money(inv.summary.commissionAmount)}`],
              ["They owe", money(inv.summary.netTotal)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-admin-ink/10 px-3 py-2">
                <p className="text-xs text-admin-ink/60">{k}</p>
                <p className="text-lg font-semibold">{v}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-admin-ink/60">
                <tr>
                  <th className="py-1.5 pr-2">Item</th>
                  <th className="py-1.5 pr-2">Size</th>
                  <th className="py-1.5 pr-2 text-right">Qty</th>
                  <th className="py-1.5 pr-2 text-right">Garment</th>
                  <th className="py-1.5 pr-2 text-right">Decoration</th>
                  <th className="py-1.5 pr-2 text-right">Unit</th>
                  <th className="py-1.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {detail.computed.lines.map((l, li) =>
                  l.sizes.map((s, si) => {
                    const orig = inv.source.lines[li]?.sizes[si];
                    return (
                      <tr key={`${li}-${si}`} className="border-t border-admin-ink/10">
                        <td className="py-1.5 pr-2">{si === 0 ? `${l.styleNumber} ${l.colorName}${l.decorationLabel ? ` · ${l.decorationLabel}${l.priceColumnLabel ? ` (${l.priceColumnLabel})` : ""}` : ""}${l.optional ? " · option" : ""}` : ""}</td>
                        <td className="py-1.5 pr-2">{s.size}</td>
                        <td className="py-1.5 pr-2 text-right">{s.quantity}</td>
                        <td className="py-1.5 pr-2 text-right">{money(s.garmentUnitPrice)}</td>
                        <td className="py-1.5 pr-2 text-right">
                          {orig && orig.decorationUnitPrice !== s.decorationUnitPrice && <span className="text-admin-ink/40 line-through mr-1">{money(orig.decorationUnitPrice)}</span>}
                          {money(s.decorationUnitPrice)}
                        </td>
                        <td className="py-1.5 pr-2 text-right">{money(s.unitPrice)}</td>
                        <td className="py-1.5 text-right font-semibold">{money(s.lineTotal)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <label className="block text-xs text-admin-ink/80">Commission %
              <input className={inputCls} type="number" min={0} max={100} step="0.5" value={pct} onChange={(e) => setPct(e.target.value === "" ? "" : Number(e.target.value))} />
            </label>
            <label className="block text-xs text-admin-ink/80">Notes on the PDF (optional; defaults to the original invoice&apos;s notes)
              <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <label className="block text-xs text-admin-ink/80 max-w-xs">Payment terms
            <select className={inputCls} value={inv.terms ?? "source"} onChange={(e) => update({ terms: e.target.value }, "Terms updated.")}>
              <option value="due-on-receipt">Due on receipt (100%, no deposit)</option>
              <option value="source">Same as {inv.sourceNumber ?? "the original"}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={inv.showCommissionNote} onChange={(e) => update({ showCommissionNote: e.target.checked })} />
            Print the commission summary on the PDF
          </label>

          {error && <p className="text-sm text-red-700">{error}</p>}
          {msg && <p className="text-sm text-green-700">{msg}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => update({ commissionPercent: pct === "" ? 0 : pct, notes }, "Saved.")} disabled={busy} className="px-3 py-1.5 rounded-xl text-sm font-semibold bg-admin-accent text-white hover:opacity-90 disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
            <a href={`/api/admin/special-invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-xl text-sm border border-admin-ink/20 hover:bg-admin-ink/5">View PDF</a>
            <a href={`/api/admin/special-invoices/${inv.id}/pdf?download=1`} className="px-3 py-1.5 rounded-xl text-sm border border-admin-ink/20 hover:bg-admin-ink/5">Download</a>
            <button onClick={() => update({ status: inv.status === "paid" ? "unpaid" : "paid" })} disabled={busy} className="px-3 py-1.5 rounded-xl text-sm border border-admin-ink/20 hover:bg-admin-ink/5">
              Mark {inv.status === "paid" ? "unpaid" : "paid"}
            </button>
            <button
              onClick={() => window.confirm(`Re-copy the items from ${inv.sourceNumber ?? "the original"}? Use this if you edited the original invoice.`) && update({ refreshFromSource: true }, "Updated from the original.")}
              disabled={busy}
              className="px-3 py-1.5 rounded-xl text-sm border border-admin-ink/20 hover:bg-admin-ink/5"
            >
              Refresh from {inv.sourceNumber ?? "original"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
