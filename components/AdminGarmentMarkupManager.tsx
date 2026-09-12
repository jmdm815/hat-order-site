"use client";

import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { GarmentMarkupBreakpoint, GarmentMarkupLookupMode, GarmentMarkupSettings } from "@/lib/types";

// Cost-based markup matrix applied to garment (blank) cost in the admin
// quote builder — a garment costing $X gets marked up by whichever
// breakpoint's [from, to] range contains X before decoration cost is added.
// Rows are fully editable in place (no separate open/edit panel), matching
// how this table works in the reference app it's modeled on. See
// lib/garment-markup-store.ts / lib/garment-markup.ts for the persistence
// and lookup logic, and lib/quote.ts for where it's applied.
export default function AdminGarmentMarkupManager() {
  const [breakpoints, setBreakpoints] = useState<GarmentMarkupBreakpoint[]>([]);
  const [lookupMode, setLookupMode] = useState<GarmentMarkupLookupMode>("per-style-quantity");
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  function load() {
    fetch("/api/admin/garment-markup")
      .then((r) => r.json())
      .then((data: { settings: GarmentMarkupSettings; persistent: boolean }) => {
        setBreakpoints(data.settings.breakpoints);
        setLookupMode(data.settings.lookupMode);
        setPersistent(data.persistent);
        setDirty(false);
      })
      .catch(() => setMessage("Failed to load garment markup settings."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function updateRow(id: string, patch: Partial<GarmentMarkupBreakpoint>) {
    setBreakpoints((prev) => prev.map((bp) => (bp.id === id ? { ...bp, ...patch } : bp)));
    setDirty(true);
  }

  function addRow() {
    const last = breakpoints[breakpoints.length - 1];
    const from = last ? last.to : 0;
    setBreakpoints((prev) => [...prev, { id: uuid(), from, to: from + 25, markupPercent: 0 }]);
    setDirty(true);
  }

  function removeRow(id: string) {
    setBreakpoints((prev) => prev.filter((bp) => bp.id !== id));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/garment-markup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ breakpoints, lookupMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setBreakpoints(data.settings.breakpoints);
      setLookupMode(data.settings.lookupMode);
      setMessage(data.persisted ? "Saved." : "Saved for now — no durable storage connected, see note above.");
      setDirty(false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-navy/40 text-sm">Loading…</p>;
  }

  return (
    <div>
      {!persistent && (
        <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No durable storage is connected to this deployment yet, so changes only last until the
          next cold start or redeploy. Connect a Vercel Blob store to this project (Vercel
          dashboard → Storage → Create Database → Blob → Connect to Project) to make changes
          stick.
        </p>
      )}

      <h3 className="font-semibold text-navy text-base">Markups</h3>
      <p className="mt-2 text-sm text-navy/70 max-w-2xl">
        Markups are required. Markups are applied to the cost of the blank garment from your
        vendor. If a garment costs you $2.00 and your markup is 100%, the selling price for the
        blank garment would be $2.00 + (100% * $2.00) = $4.00.
      </p>
      <p className="mt-3 text-sm text-navy/70 max-w-2xl">
        Breakpoints are matched against each garment&apos;s vendor cost — the first row whose
        &quot;From&quot;/&quot;To $&quot; range contains that cost sets its markup. You can edit
        all values directly in the table.
      </p>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full border border-navy/10 rounded-xl overflow-hidden text-sm">
          <thead>
            <tr className="bg-navy/[0.03] text-left text-navy/70">
              <th className="px-4 py-2.5 font-medium">From</th>
              <th className="px-4 py-2.5 font-medium">To $</th>
              <th className="px-4 py-2.5 font-medium">Markup (%)</th>
              <th className="px-4 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {breakpoints.map((bp, i) => (
              <tr key={bp.id} className={i % 2 === 0 ? "bg-white" : "bg-navy/[0.015]"}>
                <td className="px-4 py-2 border-t border-navy/10">
                  <input
                    type="number"
                    step="0.01"
                    value={bp.from}
                    onChange={(e) => updateRow(bp.id, { from: Number(e.target.value) || 0 })}
                    className="w-24 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-4 py-2 border-t border-navy/10">
                  <input
                    type="number"
                    step="0.01"
                    value={bp.to}
                    onChange={(e) => updateRow(bp.id, { to: Number(e.target.value) || 0 })}
                    className="w-24 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-4 py-2 border-t border-navy/10">
                  <input
                    type="number"
                    step="1"
                    value={bp.markupPercent}
                    onChange={(e) => updateRow(bp.id, { markupPercent: Number(e.target.value) || 0 })}
                    className="w-24 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-4 py-2 border-t border-navy/10 text-center">
                  <button
                    onClick={() => removeRow(bp.id)}
                    aria-label="Delete breakpoint"
                    className="text-red-600 hover:text-red-800"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {breakpoints.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-navy/40 border-t border-navy/10">
                  No breakpoints yet — garments will sell at raw vendor cost with no markup.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button
        onClick={addRow}
        className="mt-3 px-4 py-2 rounded-lg border border-green-600/40 text-green-700 text-sm font-medium hover:bg-green-50"
      >
        + Add New Breakpoint
      </button>

      <div className="mt-8">
        <h3 className="font-semibold text-navy text-base">Look up markup rates</h3>
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-navy/80">
            <input
              type="radio"
              name="lookupMode"
              checked={lookupMode === "total-quantity"}
              onChange={() => {
                setLookupMode("total-quantity");
                setDirty(true);
              }}
            />
            Apply markup based on the total quantity of apparel items (regardless of the number
            of different styles)
          </label>
          <label className="flex items-center gap-2 text-sm text-navy/80">
            <input
              type="radio"
              name="lookupMode"
              checked={lookupMode === "per-style-quantity"}
              onChange={() => {
                setLookupMode("per-style-quantity");
                setDirty(true);
              }}
            />
            Apply markup based on quantities for each specific style of apparel item
          </label>
        </div>
        <p className="mt-2 text-xs text-navy/40 max-w-2xl">
          This table&apos;s breakpoints are matched by garment cost, not quantity, so this setting
          isn&apos;t used by pricing yet — it&apos;s saved here for a future quantity-based markup
          mode.
        </p>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {message && <p className="text-sm text-navy/70">{message}</p>}
      </div>
    </div>
  );
}
