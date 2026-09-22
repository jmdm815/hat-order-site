"use client";

import { useEffect, useMemo, useState } from "react";
import { Customer } from "@/lib/types";

type ApiResponse = { customers: Customer[]; persistent: boolean };

const EMPTY_FORM = { name: "", company: "", email: "", phone: "", notes: "" };

export default function AdminCustomersManager() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/admin/customers")
      .then((r) => r.json())
      .then((data: ApiResponse) => {
        setCustomers(data.customers);
        setPersistent(data.persistent);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.name, c.company, c.email, c.phone].some((f) => f?.toLowerCase().includes(q))
    );
  }, [customers, search]);

  function startAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  function startEdit(c: Customer) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      company: c.company ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      notes: c.notes ?? "",
    });
    setError(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isUpdate = Boolean(editingId);
      const res = await fetch(isUpdate ? `/api/admin/customers/${editingId}` : "/api/admin/customers", {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save customer");
      if (isUpdate) {
        setCustomers((prev) => prev.map((c) => (c.id === editingId ? data.customer : c)));
      } else {
        setCustomers((prev) => [...prev, data.customer]);
      }
      startAdd();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this customer? This only removes the contact card — any quotes already saved for them are unaffected.")) {
      return;
    }
    const res = await fetch(`/api/admin/customers/${id}`, { method: "DELETE" });
    if (res.ok) {
      setCustomers((prev) => prev.filter((c) => c.id !== id));
      if (editingId === id) startAdd();
    }
  }

  if (loading) return <p className="text-navy/40 text-sm">Loading customers…</p>;

  return (
    <div>
      {!persistent && (
        <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No durable storage is connected to this deployment yet, so customers only last until the
          next cold start or redeploy. Connect a Vercel Blob store to make changes stick.
        </p>
      )}

      <section className="bg-white border border-navy/10 rounded-xl p-4 max-w-2xl">
        <h3 className="text-sm font-semibold text-navy mb-3">
          {editingId ? "Edit customer" : "Add a customer"}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-navy/60">
            Name *
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
              placeholder="Jane Smith"
            />
          </label>
          <label className="text-xs text-navy/60">
            Company (optional)
            <input
              value={form.company}
              onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-navy/60">
            Email (optional)
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-navy/60">
            Phone (optional)
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <label className="block text-xs text-navy/60 mt-3">
          Notes (optional)
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            rows={2}
          />
        </label>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="px-4 py-1.5 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
          >
            {saving ? "Saving…" : editingId ? "Save changes" : "+ Add customer"}
          </button>
          {editingId && (
            <button
              onClick={startAdd}
              className="px-4 py-1.5 rounded-full border border-navy/20 text-sm text-navy/70 hover:bg-navy/5"
            >
              Cancel
            </button>
          )}
        </div>
      </section>

      <div className="mt-6 max-w-2xl">
        <input
          type="text"
          placeholder="Search customers by name, company, email, or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-navy/20 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {customers.length === 0 ? (
        <p className="mt-4 text-sm text-navy/50">No customers yet — add one above.</p>
      ) : filtered.length === 0 ? (
        <p className="mt-4 text-sm text-navy/50">No customers match &quot;{search}&quot;.</p>
      ) : (
        <div className="mt-4 divide-y divide-navy/10 border border-navy/10 rounded-xl max-w-2xl overflow-hidden">
          {filtered.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-3 p-3 bg-white">
              <div className="min-w-0">
                <div className="text-sm font-medium text-navy">
                  {c.name}
                  {c.company && <span className="text-navy/40 font-normal"> · {c.company}</span>}
                </div>
                <div className="text-xs text-navy/60 mt-0.5">
                  {[c.email, c.phone].filter(Boolean).join(" · ") || (
                    <span className="text-navy/30">No email or phone on file</span>
                  )}
                </div>
                {c.notes && <div className="text-xs text-navy/40 mt-1 whitespace-pre-wrap">{c.notes}</div>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => startEdit(c)}
                  className="text-xs text-navy/60 px-2 py-1 rounded-lg border border-navy/20 hover:bg-navy/5"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(c.id)}
                  className="text-xs text-red-600 px-2 py-1 hover:bg-red-50 rounded-lg"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
