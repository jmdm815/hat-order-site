"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Customer, CustomerContact } from "@/lib/types";
import type { RecordSummary } from "@/lib/customer-match";
import { DocNumberButton } from "./AdminRowLinks";

// Customer page (like ShopVox's): contact card + balance overview, then
// Transactions (every quote and invoice) and Payments tabs. Data comes from
// /api/admin/customers/[id]/overview.

type Payment = {
  id: string;
  recordId: string;
  number?: string;
  amount: number;
  method: string;
  checkNumber?: string;
  note?: string;
  date: string;
};
type Overview = {
  customer: Customer;
  transactions: RecordSummary[];
  payments: Payment[];
  stats: { balance: number; openInvoices: number; totalInvoiced: number; totalPaid: number };
  unlinked: RecordSummary[];
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card",
  shopvox: "ShopVox",
  zelle: "Zelle",
  other: "Other",
  manual: "Manual",
};
const input = "w-full border border-admin-ink/20 rounded-lg px-3 py-2 bg-transparent text-admin-ink text-sm";

function StatusPill({ t }: { t: RecordSummary }) {
  const cls =
    t.status === "Paid"
      ? "bg-green-500/15 text-green-700"
      : t.status === "Open" || t.status === "Partially paid"
        ? "bg-amber-400/15 text-amber-700"
        : t.status.startsWith("Converted")
          ? "bg-admin-ink/10 text-admin-ink/60"
          : "bg-sky-400/15 text-sky-700";
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{t.status}</span>;
}

type ContactDraft = { id?: string; name: string; role: string; email: string; phone: string; notes: string };
const emptyDraft: ContactDraft = { name: "", role: "", email: "", phone: "", notes: "" };

function ContactsCard({ customer, onSaved }: { customer: Customer; onSaved: () => Promise<void> }) {
  const contacts = customer.contacts ?? [];
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: CustomerContact[]) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/customers/${customer.id}/contacts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't save contacts");
      setDraft(null);
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function submitDraft() {
    if (!draft || !draft.name.trim()) return;
    const clean = {
      name: draft.name.trim(),
      role: draft.role.trim() || undefined,
      email: draft.email.trim() || undefined,
      phone: draft.phone.trim() || undefined,
      notes: draft.notes.trim() || undefined,
    };
    const next = draft.id
      ? contacts.map((c) => (c.id === draft.id ? { ...c, ...clean } : c))
      : [...contacts, { id: "", ...clean } as CustomerContact];
    save(next);
  }

  const rows: { contact: CustomerContact; primary: boolean }[] = [
    {
      contact: { id: "primary", name: customer.contactName || customer.name, email: customer.email, phone: customer.phone },
      primary: true,
    },
    ...contacts.map((c) => ({ contact: c, primary: false })),
  ];

  return (
    <div className="border border-admin-ink/15 rounded-2xl bg-admin-card">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-admin-ink/10">
        <h2 className="font-semibold">Contacts ({rows.length})</h2>
        {!draft && (
          <button onClick={() => setDraft({ ...emptyDraft })} className="text-sm px-3 py-1.5 rounded-lg border border-admin-ink/20 hover:bg-admin-ink/[0.04]">
            + Add contact
          </button>
        )}
      </div>
      <ul className="divide-y divide-admin-ink/10">
        {rows.map(({ contact: ct, primary }) => (
          <li key={ct.id} className="px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {ct.name}
                {primary && <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5">Primary</span>}
                {ct.role && <span className="ml-2 text-sm text-admin-ink/60 font-normal">{ct.role}</span>}
              </p>
              <p className="text-sm text-admin-ink/75 flex flex-wrap gap-x-3">
                {ct.email && (
                  <a href={`mailto:${ct.email}`} className="underline break-all">
                    {ct.email}
                  </a>
                )}
                {ct.phone && (
                  <a href={`tel:${ct.phone}`} className="underline">
                    {ct.phone}
                  </a>
                )}
                {!ct.email && !ct.phone && <span className="text-admin-ink/45">No email or phone</span>}
              </p>
              {ct.notes && <p className="text-xs text-admin-ink/60 mt-0.5">{ct.notes}</p>}
            </div>
            <div className="flex gap-2 text-sm">
              <Link
                href={`/admin/quotes/new?customerId=${customer.id}${primary ? "" : `&contactId=${ct.id}`}`}
                className="px-2.5 py-1 rounded-lg border border-admin-ink/20 hover:bg-admin-ink/[0.04]"
                title={`Start a quote for ${ct.name}`}
              >
                New quote
              </Link>
              {!primary && (
                <>
                  <button
                    onClick={() =>
                      setDraft({ id: ct.id, name: ct.name, role: ct.role ?? "", email: ct.email ?? "", phone: ct.phone ?? "", notes: ct.notes ?? "" })
                    }
                    className="px-2.5 py-1 rounded-lg border border-admin-ink/20 hover:bg-admin-ink/[0.04]"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => save(contacts.filter((c) => c.id !== ct.id))}
                    disabled={busy}
                    className="px-2.5 py-1 rounded-lg text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {draft && (
        <div className="px-5 py-4 border-t border-admin-ink/10 grid sm:grid-cols-2 gap-3">
          {(
            [
              ["name", "Name"],
              ["role", "Role / title (optional)"],
              ["email", "Email"],
              ["phone", "Phone"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="text-xs uppercase tracking-wide text-admin-ink/70">
              {l}
              <input
                className={`${input} mt-1`}
                value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                autoFocus={k === "name"}
              />
            </label>
          ))}
          <label className="sm:col-span-2 text-xs uppercase tracking-wide text-admin-ink/70">
            Notes (optional)
            <input className={`${input} mt-1`} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </label>
          {err && <p className="sm:col-span-2 text-sm text-red-600">{err}</p>}
          <div className="sm:col-span-2 flex gap-2">
            <button
              onClick={submitDraft}
              disabled={busy || !draft.name.trim()}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-admin-accent text-admin-accent-ink disabled:opacity-50"
            >
              {busy ? "Saving…" : draft.id ? "Save contact" : "Add contact"}
            </button>
            <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-xl text-sm border border-admin-ink/20">
              Cancel
            </button>
          </div>
        </div>
      )}
      {!draft && err && <p className="px-5 pb-3 text-sm text-red-600">{err}</p>}
      <p className="px-5 pb-4 pt-1 text-xs text-admin-ink/55">To change the primary contact, use Edit at the top of the page.</p>
    </div>
  );
}

export default function AdminCustomerPage({ customerId }: { customerId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"transactions" | "payments">("transactions");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "quote" | "invoice" | "open">("all");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", contactName: "", email: "", phone: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkBusy, setLinkBusy] = useState<string | null>(null);

  const fetchOverview = useCallback(async (): Promise<Overview> => {
    const res = await fetch(`/api/admin/customers/${customerId}/overview`, { cache: "no-store" });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Couldn't load this customer");
    return j;
  }, [customerId]);

  const load = useCallback(async () => {
    try {
      setData(await fetchOverview());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [fetchOverview]);

  useEffect(() => {
    let alive = true;
    fetchOverview()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [fetchOverview]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.transactions.filter((t) => {
      if (filter === "quote" && t.kind !== "quote") return false;
      if (filter === "invoice" && t.kind !== "invoice") return false;
      if (filter === "open" && t.balance <= 0) return false;
      if (!q) return true;
      return [t.number, t.itemsSummary, t.contactName, t.status, String(t.total)].some((f) => f?.toLowerCase().includes(q));
    });
  }, [data, search, filter]);

  const linkMatches = useMemo(() => {
    if (!data) return [];
    const q = linkSearch.trim().toLowerCase();
    return data.unlinked
      .filter((t) => !q || [t.number, t.contactName, t.itemsSummary].some((f) => f?.toLowerCase().includes(q)))
      .slice(0, 12);
  }, [data, linkSearch]);

  function startEdit() {
    if (!data) return;
    const c = data.customer;
    setForm({
      name: c.contactName ? c.name : c.company ?? c.name,
      contactName: c.contactName ?? (c.company ? c.name : ""),
      email: c.email ?? "",
      phone: c.phone ?? "",
      notes: c.notes ?? "",
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, defaultDepositPercent: data.customer.defaultDepositPercent }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't save");
      setEditing(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function link(recordId: string, unlink = false) {
    setLinkBusy(recordId);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId, unlink }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't link");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkBusy(null);
    }
  }

  if (error && !data) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-admin-ink/70">Loading…</p>;
  const c = data.customer;

  return (
    <div className="text-admin-ink space-y-6">
      <a href="/admin?tab=customers" className="inline-block text-sm text-admin-ink/60 hover:text-admin-ink">
        ← All customers
      </a>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold leading-tight">{c.name}</h1>
          {(c.contactName || c.company) && <p className="text-admin-ink/70">{c.contactName ? `Contact: ${c.contactName}` : c.company}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/quotes/new?customerId=${c.id}`}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-admin-accent text-admin-accent-ink"
          >
            + New quote
          </Link>
          <Link
            href={`/admin/quotes/new?kind=invoice&customerId=${c.id}`}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-admin-accent text-admin-accent"
          >
            + New invoice
          </Link>
          <button onClick={startEdit} className="px-4 py-2 rounded-xl text-sm border border-admin-ink/20">
            Edit
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {editing ? (
        <div className="border border-admin-ink/15 rounded-2xl p-4 bg-admin-card grid sm:grid-cols-2 gap-3">
          {(
            [
              ["name", "Customer / company name"],
              ["contactName", "Primary contact"],
              ["email", "Email"],
              ["phone", "Phone"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="text-xs uppercase tracking-wide text-admin-ink/70">
              {l}
              <input className={`${input} mt-1`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          <label className="sm:col-span-2 text-xs uppercase tracking-wide text-admin-ink/70">
            Notes
            <textarea
              className={`${input} mt-1`}
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <div className="sm:col-span-2 flex gap-2">
            <button
              onClick={saveEdit}
              disabled={saving || !form.name.trim()}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-admin-accent text-admin-accent-ink disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl text-sm border border-admin-ink/20">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-admin-ink/15 rounded-2xl p-5 bg-admin-card grid sm:grid-cols-3 gap-5">
          <div>
            <h2 className="font-semibold mb-2">Overview</h2>
            <p className="text-xs text-admin-ink/60">Balance</p>
            <p className={`text-2xl font-bold ${data.stats.balance > 0 ? "text-amber-700" : "text-green-700"}`}>
              {money(data.stats.balance)}
            </p>
            <p className="text-xs text-admin-ink/60 mt-2">
              {data.stats.openInvoices} open invoice{data.stats.openInvoices === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-admin-ink/60 mt-1">
              Invoiced {money(data.stats.totalInvoiced)} · Paid {money(data.stats.totalPaid)}
            </p>
          </div>
          <div>
            <h2 className="font-semibold mb-2">
              Primary contact
              {(c.contacts?.length ?? 0) > 0 && (
                <span className="ml-2 text-xs font-normal text-admin-ink/60">+{c.contacts!.length} more below</span>
              )}
            </h2>
            <p className="text-sm">{c.contactName || c.name}</p>
            {c.email && (
              <a href={`mailto:${c.email}`} className="text-sm underline text-admin-ink/80 break-all">
                {c.email}
              </a>
            )}
            {c.phone && (
              <p className="text-sm">
                <a href={`tel:${c.phone}`} className="underline text-admin-ink/80">
                  {c.phone}
                </a>
              </p>
            )}
            {!c.email && !c.phone && <p className="text-sm text-admin-ink/50">No email or phone on file</p>}
            {c.defaultDepositPercent && (
              <p className="text-xs text-admin-ink/60 mt-1">Usually pays a {c.defaultDepositPercent}% deposit</p>
            )}
          </div>
          <div>
            <h2 className="font-semibold mb-2">Notes</h2>
            <p className="text-sm text-admin-ink/80 whitespace-pre-wrap">{c.notes || <span className="text-admin-ink/50">None</span>}</p>
          </div>
        </div>
      )}

      <ContactsCard customer={c} onSaved={load} />

      <div className="border-b border-admin-ink/15 flex gap-6">
        {(
          [
            ["transactions", `Transactions (${data.transactions.length})`],
            ["payments", `Payments (${data.payments.length})`],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`pb-2 -mb-px text-sm font-medium border-b-2 ${
              tab === k ? "border-admin-accent text-admin-accent" : "border-transparent text-admin-ink/70"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "transactions" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${input} sm:max-w-xs flex-1 sm:flex-none`} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="border border-admin-ink/20 rounded-lg px-3 py-2 bg-transparent text-admin-ink text-sm" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">All</option>
              <option value="quote">Quotes</option>
              <option value="invoice">Invoices</option>
              <option value="open">Unpaid balance</option>
            </select>
            <button
              onClick={() => setLinkOpen((v) => !v)}
              className="ml-auto text-sm px-3 py-2 rounded-xl border border-admin-ink/20"
              title="Attach a quote or invoice that isn't showing here"
            >
              {linkOpen ? "Done linking" : "Link a quote or invoice"}
            </button>
          </div>

          {linkOpen && (
            <div className="border border-admin-ink/15 rounded-xl p-3 bg-admin-card">
              <p className="text-xs text-admin-ink/70 mb-2">
                Quotes and invoices not linked to any customer yet ({data.unlinked.length}). To move one from another
                customer, use that customer&apos;s page or pick this customer in the quote.
              </p>
              <input
                className={`${input} max-w-xs mb-2`}
                placeholder="Search number or name…"
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
              />
              {linkMatches.length === 0 ? (
                <p className="text-sm text-admin-ink/60">Nothing to link.</p>
              ) : (
                <div className="divide-y divide-admin-ink/10">
                  {linkMatches.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        <b>{t.number}</b> · {t.contactName || "No name"} · {money(t.total)}{" "}
                        <span className="text-admin-ink/60">{t.itemsSummary}</span>
                      </span>
                      <button
                        onClick={() => link(t.id)}
                        disabled={linkBusy === t.id}
                        className="shrink-0 text-xs px-3 py-1 rounded-lg bg-admin-accent text-admin-accent-ink disabled:opacity-50"
                      >
                        {linkBusy === t.id ? "Linking…" : "Link here"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-admin-ink/60">No quotes or invoices{data.transactions.length ? " match" : " yet"}.</p>
          ) : (
            <div className="overflow-x-auto border border-admin-ink/15 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-admin-ink/5 text-left text-xs uppercase tracking-wide text-admin-ink/70">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Items</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-ink/10">
                  {rows.map((t) => (
                    <tr key={t.id} className="hover:bg-admin-ink/5">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-bold mr-2 ${
                            t.kind === "invoice" ? "bg-green-500/20 text-green-700" : "bg-violet-400/20 text-violet-700"
                          }`}
                        >
                          {t.kind === "invoice" ? "IN" : "QT"}
                        </span>
                        <DocNumberButton id={t.id} number={t.number} />
                      </td>
                      <td className="px-3 py-2 max-w-xs truncate text-admin-ink/80" title={t.itemsSummary}>
                        {t.itemsSummary || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-admin-ink/80">{fmtDate(t.date)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{money(t.total)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{t.kind === "invoice" ? money(t.balance) : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <StatusPill t={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "payments" &&
        (data.payments.length === 0 ? (
          <p className="text-sm text-admin-ink/60">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto border border-admin-ink/15 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-admin-ink/5 text-left text-xs uppercase tracking-wide text-admin-ink/70">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">For</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-ink/10">
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(p.date)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/quotes/${p.recordId}`} className="underline">
                        {p.number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {METHOD_LABEL[p.method] ?? p.method}
                      {p.checkNumber ? ` #${p.checkNumber}` : ""}
                    </td>
                    <td className="px-3 py-2 text-right">{money(p.amount)}</td>
                    <td className="px-3 py-2 text-admin-ink/70">{p.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
