"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Customer } from "@/lib/types";

type ApiResponse = { customers: Customer[]; persistent: boolean };

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  skippedRows: { row: number; reason: string }[];
  totalRows: number;
  persisted: boolean;
};

const EMPTY_FORM = { name: "", company: "", email: "", phone: "", notes: "", defaultDepositPercent: "" };

const IMPORT_TEMPLATE_CSV =
  "Name,Company,Email,Phone,Notes\nJane Smith,Smith Construction,jane@smithconstruction.com,555-123-4567,Prefers embroidered logos\n";

function downloadImportTemplate() {
  const blob = new Blob([IMPORT_TEMPLATE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "customer-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminCustomersManager() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

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
    setShowImport(false);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  function openImport() {
    setShowForm(false);
    setImportError(null);
    setImportResult(null);
    setShowImport(true);
  }

  function closeImport() {
    setShowImport(false);
    setImportError(null);
    setImportResult(null);
    if (importFileRef.current) importFileRef.current.value = "";
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/admin/customers/import", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setImportResult(data);
      load(); // refresh the list/count with the newly imported customers
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  function startEdit(c: Customer) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      company: c.company ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      notes: c.notes ?? "",
      defaultDepositPercent: c.defaultDepositPercent ? String(c.defaultDepositPercent) : "",
    });
    setError(null);
    setShowForm(true);
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
      const depositPercentNum = form.defaultDepositPercent.trim()
        ? Number(form.defaultDepositPercent)
        : undefined;
      const res = await fetch(isUpdate ? `/api/admin/customers/${editingId}` : "/api/admin/customers", {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, defaultDepositPercent: depositPercentNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save customer");
      if (isUpdate) {
        setCustomers((prev) => prev.map((c) => (c.id === editingId ? data.customer : c)));
      } else {
        setCustomers((prev) => [...prev, data.customer]);
      }
      closeForm();
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
      if (editingId === id) closeForm();
    }
  }

  function toggleSelectMode() {
    setSelectMode((on) => {
      if (on) setSelectedIds(new Set()); // turning off — clear selection
      return !on;
    });
  }

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        // Deselect just what's visible, keep any selection outside the current search.
        const next = new Set(prev);
        filtered.forEach((c) => next.delete(c.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((c) => next.add(c.id));
      return next;
    });
  }

  async function handleBulkDelete() {
    const count = selectedIds.size;
    if (count === 0) return;
    const allSelected = count === customers.length;
    const confirmed = confirm(
      allSelected
        ? `Delete all ${count} customers? This only removes the contact cards — any quotes already saved for them are unaffected. This can't be undone.`
        : `Delete ${count} selected customer${count === 1 ? "" : "s"}? This only removes the contact card${
            count === 1 ? "" : "s"
          } — any quotes already saved for them are unaffected.`
    );
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      const res = await fetch("/api/admin/customers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        setCustomers((prev) => prev.filter((c) => !selectedIds.has(c.id)));
        setSelectedIds(new Set());
        setSelectMode(false);
        if (editingId && selectedIds.has(editingId)) closeForm();
      }
    } finally {
      setBulkDeleting(false);
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

      {/* Header bar: count + search + the "+" button that reveals the form, instead of the form always being open */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <h3 className="text-sm font-semibold text-navy">
          Customers <span className="text-navy/40 font-normal">({customers.length})</span>
        </h3>
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-xl ml-auto">
          <input
            type="text"
            placeholder="Search customers by name, company, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border border-navy/20 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={toggleSelectMode}
            className={`shrink-0 px-3 h-9 flex items-center justify-center rounded-full border text-sm font-medium transition ${
              selectMode
                ? "border-navy bg-navy text-white"
                : "border-navy/20 text-navy/70 hover:bg-navy/5"
            }`}
            title="Select customers to delete"
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
          <button
            onClick={() => (showImport ? closeImport() : openImport())}
            className="shrink-0 px-3 h-9 flex items-center justify-center rounded-full border border-navy/20 text-navy/70 text-sm font-medium hover:bg-navy/5 transition"
            title="Import customers from a CSV or Excel file"
          >
            Import
          </button>
          <button
            onClick={() => (showForm && !editingId ? closeForm() : startAdd())}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-red text-white text-lg font-semibold leading-none hover:bg-navy transition"
            title="Add a customer"
            aria-label="Add a customer"
          >
            +
          </button>
        </div>
      </div>

      {selectMode && customers.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 bg-navy/5 border border-navy/10 rounded-xl px-3 py-2 max-w-2xl">
          <label className="flex items-center gap-2 text-sm text-navy/70 cursor-pointer">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4"
            />
            Select all {search.trim() ? `(${filtered.length} shown)` : `(${filtered.length})`}
          </label>
          <span className="text-sm text-navy/50">
            {selectedIds.size} selected
          </span>
          <button
            onClick={handleBulkDelete}
            disabled={selectedIds.size === 0 || bulkDeleting}
            className="ml-auto px-4 py-1.5 rounded-full bg-red text-white text-sm font-semibold hover:bg-red-dark transition disabled:bg-navy/20"
          >
            {bulkDeleting
              ? "Deleting…"
              : selectedIds.size === customers.length && selectedIds.size > 0
              ? `Delete all (${selectedIds.size})`
              : `Delete selected (${selectedIds.size})`}
          </button>
        </div>
      )}

      {showImport && (
        <section className="mt-4 bg-white border border-navy/10 rounded-xl p-4 max-w-2xl">
          <h3 className="text-sm font-semibold text-navy mb-1">Import customers</h3>
          <p className="text-xs text-navy/50">
            Upload a CSV or Excel (.xls/.xlsx) file with a header row. A <span className="font-medium">Name</span>{" "}
            column is required — Company, Email, Phone, and Notes columns are optional and can be in any order. If
            your list only has a Company Name column and no separate Name column, that&apos;s fine too — it&apos;ll
            be used as the name. Rows whose email matches an existing customer update that customer instead of
            creating a duplicate.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              ref={importFileRef}
              type="file"
              accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
              }}
              disabled={importing}
              className="text-xs text-navy/70"
            />
            <button
              onClick={downloadImportTemplate}
              className="text-xs text-navy/60 px-2 py-1 rounded-lg border border-navy/20 hover:bg-navy/5"
            >
              Download template
            </button>
            {importing && <span className="text-xs text-navy/50">Importing…</span>}
          </div>

          {importError && <p className="mt-3 text-sm text-red-600">{importError}</p>}

          {importResult && (
            <div className="mt-3 text-sm text-navy bg-tan/20 border border-tan/40 rounded-lg px-3 py-2">
              <p>
                Imported {importResult.totalRows} row{importResult.totalRows === 1 ? "" : "s"}:{" "}
                <span className="font-semibold">{importResult.created} added</span>,{" "}
                <span className="font-semibold">{importResult.updated} updated</span>
                {importResult.skipped > 0 && (
                  <>
                    , <span className="font-semibold">{importResult.skipped} skipped</span>
                  </>
                )}
                .
              </p>
              {!importResult.persisted && (
                <p className="mt-1 text-xs text-amber-700">
                  No durable storage is connected yet, so this import won&apos;t survive a redeploy.
                </p>
              )}
              {importResult.skippedRows.length > 0 && (
                <ul className="mt-2 text-xs text-navy/60 list-disc list-inside space-y-0.5">
                  {importResult.skippedRows.map((r) => (
                    <li key={r.row}>
                      Row {r.row}: {r.reason}
                    </li>
                  ))}
                  {importResult.skipped > importResult.skippedRows.length && (
                    <li>…and {importResult.skipped - importResult.skippedRows.length} more</li>
                  )}
                </ul>
              )}
            </div>
          )}

          <div className="mt-3">
            <button
              onClick={closeImport}
              className="px-4 py-1.5 rounded-full border border-navy/20 text-sm text-navy/70 hover:bg-navy/5"
            >
              Close
            </button>
          </div>
        </section>
      )}

      {showForm && (
        <section className="mt-4 bg-white border border-navy/10 rounded-xl p-4 max-w-2xl">
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
                autoFocus
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
            <label className="text-xs text-navy/60">
              Default deposit % (optional — leave blank for &quot;pays in full&quot;)
              <input
                type="number"
                min={1}
                max={99}
                value={form.defaultDepositPercent}
                onChange={(e) => setForm((f) => ({ ...f, defaultDepositPercent: e.target.value }))}
                placeholder="e.g. 50"
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
            <button
              onClick={closeForm}
              className="px-4 py-1.5 rounded-full border border-navy/20 text-sm text-navy/70 hover:bg-navy/5"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {customers.length === 0 ? (
        <p className="mt-4 text-sm text-navy/50">
          No customers yet — tap <span className="font-semibold text-navy">+</span> above to add one.
        </p>
      ) : filtered.length === 0 ? (
        <p className="mt-4 text-sm text-navy/50">No customers match &quot;{search}&quot;.</p>
      ) : (
        <div className="mt-4 divide-y divide-navy/10 border border-navy/10 rounded-xl max-w-2xl overflow-hidden">
          {filtered.map((c) => (
            <div
              key={c.id}
              className={`flex items-start justify-between gap-3 p-3 bg-white ${
                selectMode ? "cursor-pointer hover:bg-navy/5" : ""
              }`}
              onClick={selectMode ? () => toggleSelectOne(c.id) : undefined}
            >
              <div className="flex items-start gap-3 min-w-0">
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => toggleSelectOne(c.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-0.5 w-4 h-4 shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-navy">
                    {c.name}
                    {c.company && <span className="text-navy/40 font-normal"> · {c.company}</span>}
                  </div>
                  <div className="text-xs text-navy/60 mt-0.5">
                    {[c.email, c.phone].filter(Boolean).join(" · ") || (
                      <span className="text-navy/30">No email or phone on file</span>
                    )}
                    {c.defaultDepositPercent && (
                      <span className="text-navy/40"> · {c.defaultDepositPercent}% deposit</span>
                    )}
                  </div>
                  {c.notes && <div className="text-xs text-navy/40 mt-1 whitespace-pre-wrap">{c.notes}</div>}
                </div>
              </div>
              {!selectMode && (
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
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
