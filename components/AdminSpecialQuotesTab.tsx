"use client";

import { useEffect, useState } from "react";

// Special quotes: one-off PDF quotes with hand-set pricing tiers, outside the
// normal price tables. List on top; selecting one (or "New") opens the editor.
// Lines are pricing options (no grand total). See lib/special-quotes-store.ts.

type Line = { title: string; detail?: string; qty: number | ""; each: number | "" };
type SpecialQuote = {
  id: string;
  number: string;
  date: string;
  customerId?: string;
  customerName: string;
  customerCompany?: string;
  customerEmail?: string;
  intro?: string;
  footnote?: string;
  notes?: string;
  lines: { title: string; detail?: string; qty: number; each: number }[];
  updatedAt: string;
};
type Draft = Omit<SpecialQuote, "id" | "number" | "updatedAt" | "lines"> & { lines: Line[] };
type Customer = { id: string; name: string; contactName?: string; company?: string; email?: string };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const blankDraft = (): Draft => ({
  date: today(),
  customerName: "",
  customerCompany: "",
  customerEmail: "",
  intro: "",
  footnote: "Pricing options. Choose the quantity that works best for you.",
  notes: "",
  lines: [{ title: "", qty: "", each: "" }],
});
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inputCls = "mt-1 w-full border border-admin-ink/20 rounded-xl px-2 py-1.5 text-sm bg-admin-card";

export default function AdminSpecialQuotesTab() {
  const [quotes, setQuotes] = useState<SpecialQuote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/special-quotes", { cache: "no-store" });
      const data = await res.json();
      setQuotes(data.quotes ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    fetch("/api/admin/customers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []))
      .catch(() => {});
  }, []);

  function openQuote(q: SpecialQuote) {
    setEditingId(q.id);
    setDraft({ ...q, lines: q.lines.map((l) => ({ ...l })) });
    setError("");
    setMsg("");
  }
  function openNew() {
    setEditingId("new");
    setDraft(blankDraft());
    setError("");
    setMsg("");
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setLine = (i: number, patch: Partial<Line>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  function pickCustomer(id: string) {
    const c = customers.find((x) => x.id === id);
    if (!c) return set("customerId", undefined);
    setDraft((d) => ({
      ...d,
      customerId: c.id,
      customerName: c.contactName || c.name,
      customerCompany: c.company || (c.contactName ? c.name : ""),
      customerEmail: c.email || "",
    }));
  }

  async function save(): Promise<SpecialQuote | null> {
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const body = {
        ...draft,
        lines: draft.lines
          .filter((l) => l.qty !== "" && l.each !== "")
          .map((l) => ({ ...l, title: l.title.trim() || `${l.qty} Items` })),
      };
      const isNew = editingId === "new";
      const res = await fetch(isNew ? "/api/admin/special-quotes" : `/api/admin/special-quotes/${editingId}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setEditingId(data.quote.id);
      setDraft({ ...data.quote, lines: data.quote.lines });
      setMsg(`Saved ${data.quote.number}.`);
      await load();
      return data.quote;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndOpenPdf() {
    const w = window.open("", "_blank");
    const q = await save();
    if (q && w) w.location.href = `/api/admin/special-quotes/${q.id}/pdf`;
    else w?.close();
  }

  async function remove(q: SpecialQuote) {
    if (!window.confirm(`Delete special quote ${q.number}? This can't be undone.`)) return;
    await fetch(`/api/admin/special-quotes/${q.id}`, { method: "DELETE" });
    if (editingId === q.id) setEditingId(null);
    await load();
  }

  const current = quotes.find((q) => q.id === editingId);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-admin-card border border-admin-ink/10 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-admin-ink/10">
          <h2 className="font-semibold text-admin-ink">Saved special quotes</h2>
          <button onClick={openNew} className="px-3 py-1.5 rounded-xl text-sm font-semibold bg-admin-accent text-white hover:opacity-90">
            + New special quote
          </button>
        </div>
        {loading ? (
          <p className="px-4 py-6 text-sm text-admin-ink/60">Loading…</p>
        ) : quotes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-admin-ink/60">No special quotes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-admin-ink/60">
                <tr>
                  <th className="px-4 py-2">Quote #</th>
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Tiers</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} className={`border-t border-admin-ink/10 ${q.id === editingId ? "bg-admin-ink/5" : ""}`}>
                    <td className="px-4 py-2.5 font-semibold">
                      <button onClick={() => openQuote(q)} className="text-admin-accent hover:underline">{q.number}</button>
                    </td>
                    <td className="px-4 py-2.5">
                      {q.customerName}
                      {q.customerCompany ? <span className="text-admin-ink/60"> · {q.customerCompany}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{q.date}</td>
                    <td className="px-4 py-2.5 text-admin-ink/70">
                      {q.lines.map((l) => `${l.qty} @ ${money(l.each)}`).join(" · ")}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right space-x-2">
                      <a href={`/api/admin/special-quotes/${q.id}/pdf`} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded-lg bg-admin-ink/10 hover:bg-admin-ink/20">PDF</a>
                      <button onClick={() => openQuote(q)} className="text-xs px-2 py-1 rounded-lg bg-admin-ink/10 hover:bg-admin-ink/20">Edit</button>
                      <button onClick={() => remove(q)} className="text-xs px-2 py-1 rounded-lg text-red-700 hover:bg-red-50">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingId && (
        <div className="rounded-2xl bg-admin-card border border-admin-ink/10 p-4 sm:p-5 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-admin-ink">{editingId === "new" ? "New special quote" : `Edit ${current?.number ?? ""}`}</h2>
            <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 rounded-lg bg-admin-ink/10 hover:bg-admin-ink/20">Close</button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-admin-ink/80 sm:col-span-2">
              Pick a saved customer (optional)
              <select className={inputCls} value={draft.customerId ?? ""} onChange={(e) => pickCustomer(e.target.value)}>
                <option value="">— Type the details below —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.company && c.company !== c.name ? ` (${c.company})` : ""}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-admin-ink/80">Contact name
              <input className={inputCls} value={draft.customerName} onChange={(e) => set("customerName", e.target.value)} />
            </label>
            <label className="block text-xs text-admin-ink/80">Company
              <input className={inputCls} value={draft.customerCompany ?? ""} onChange={(e) => set("customerCompany", e.target.value)} />
            </label>
            <label className="block text-xs text-admin-ink/80">Email
              <input className={inputCls} type="email" value={draft.customerEmail ?? ""} onChange={(e) => set("customerEmail", e.target.value)} />
            </label>
            <label className="block text-xs text-admin-ink/80">Quote date
              <input className={inputCls} type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} />
            </label>
            <label className="block text-xs text-admin-ink/80 sm:col-span-2">Intro line (optional, above the table)
              <input className={inputCls} value={draft.intro ?? ""} onChange={(e) => set("intro", e.target.value)} />
            </label>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-admin-ink/60 mb-2">Pricing tiers</p>
            <div className="space-y-2">
              <div className="hidden sm:grid grid-cols-[1fr_1fr_80px_100px_90px_32px] gap-2 text-xs text-admin-ink/60 px-1">
                <span>Description</span><span>Detail (optional)</span><span>Qty</span><span>Price each</span><span className="text-right">Total</span><span />
              </div>
              {draft.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_80px_100px_90px_32px] gap-2 items-center">
                  <input className={inputCls + " mt-0"} placeholder={l.qty ? `${l.qty} Hats` : "e.g. 12 Hats"} value={l.title} onChange={(e) => setLine(i, { title: e.target.value })} />
                  <input className={inputCls + " mt-0"} placeholder="Style, decoration…" value={l.detail ?? ""} onChange={(e) => setLine(i, { detail: e.target.value })} />
                  <input className={inputCls + " mt-0"} type="number" min={1} placeholder="Qty" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value === "" ? "" : Number(e.target.value) })} />
                  <input className={inputCls + " mt-0"} type="number" min={0} step="0.01" placeholder="$ each" value={l.each} onChange={(e) => setLine(i, { each: e.target.value === "" ? "" : Number(e.target.value) })} />
                  <span className="text-sm font-semibold text-right">{l.qty !== "" && l.each !== "" ? money(Number(l.qty) * Number(l.each)) : "—"}</span>
                  <button
                    onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))}
                    disabled={draft.lines.length === 1}
                    className="text-red-600 text-lg leading-none disabled:opacity-30"
                    aria-label="Remove tier"
                  >×</button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, { title: "", qty: "", each: "" }] }))}
              className="mt-2 text-xs px-2 py-1 rounded-lg bg-admin-ink/10 hover:bg-admin-ink/20"
            >+ Add tier</button>
          </div>

          <div className="grid gap-3">
            <label className="block text-xs text-admin-ink/80">Highlighted line under the table
              <input className={inputCls} value={draft.footnote ?? ""} onChange={(e) => set("footnote", e.target.value)} />
            </label>
            <label className="block text-xs text-admin-ink/80">Notes (optional, printed on the PDF)
              <textarea className={inputCls} rows={3} value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
            </label>
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}
          {msg && <p className="text-sm text-green-700">{msg}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-xl text-sm font-semibold bg-admin-accent text-white hover:opacity-90 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={saveAndOpenPdf} disabled={saving} className="px-3 py-1.5 rounded-xl text-sm border border-admin-ink/20 hover:bg-admin-ink/5 disabled:opacity-50">
              Save &amp; view PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
