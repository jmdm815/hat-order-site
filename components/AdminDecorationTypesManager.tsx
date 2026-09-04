"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { DecorationOption, PriceColumn, ProductType } from "@/lib/types";
import { formatUSD } from "@/lib/pricing";

// Editable draft form for one decoration type — pricingTiers/acceptedFileTypes
// are kept in their natural array shapes; acceptedFileTypes is edited as a
// single comma-separated text field for simplicity, split/joined at the
// edges of this component.
type Draft = Omit<DecorationOption, "acceptedFileTypes"> & { acceptedFileTypesText: string };

function toDraft(d: DecorationOption): Draft {
  return { ...d, priceColumns: d.priceColumns ?? [], acceptedFileTypesText: d.acceptedFileTypes.join(", ") };
}

function fromDraft(d: Draft): Omit<DecorationOption, "id"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, acceptedFileTypesText, ...rest } = d;
  return {
    ...rest,
    acceptedFileTypes: acceptedFileTypesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

const BLANK_DRAFT: Draft = {
  id: "",
  label: "",
  shortLabel: "",
  description: "",
  productTypes: ["hat"],
  minQuantity: 12,
  setupFee: 0,
  setupFeeEnabled: true,
  pricingTiers: [{ minQty: 12, pricePerUnit: 0 }],
  priceColumns: [],
  quoteRequired: false,
  turnaroundDays: "",
  acceptedFileTypesText: "",
} as Draft;

// Full CRUD admin editor for decoration types (UV Patch, Embroidered, etc.):
// add brand-new ones, rename/edit existing ones (label, description, hat vs.
// shirt availability, accepted file types, turnaround, and pricing), and
// delete ones that aren't used. Replaces the old fixed-4-type pricing-only
// editor.
export default function AdminDecorationTypesManager() {
  const router = useRouter();
  const [decorations, setDecorations] = useState<DecorationOption[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(BLANK_DRAFT);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/decoration-types")
      .then((r) => {
        if (r.status === 401) throw new Error("unauthorized");
        return r.json();
      })
      .then((data: { decorationTypes: DecorationOption[]; persistent: boolean }) => {
        setDecorations(data.decorationTypes);
        setDrafts(Object.fromEntries(data.decorationTypes.map((d) => [d.id, toDraft(d)])));
        setPersistent(data.persistent);
      })
      .catch(() => router.refresh())
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function toggleProductType(draft: Draft, type: ProductType, checked: boolean, apply: (d: Draft) => void) {
    const next = checked
      ? [...draft.productTypes, type]
      : draft.productTypes.filter((t) => t !== type);
    apply({ ...draft, productTypes: next.length ? next : draft.productTypes });
  }

  function tierRows(draft: Draft, apply: (patch: Partial<Draft>) => void) {
    const columns: PriceColumn[] = draft.priceColumns ?? [];
    const hasColumns = columns.length > 0;

    function updateTier(i: number, field: "minQty" | "pricePerUnit", value: number) {
      apply({ pricingTiers: draft.pricingTiers.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)) });
    }
    function updateCellPrice(i: number, columnId: string, value: number) {
      apply({
        pricingTiers: draft.pricingTiers.map((t, idx) =>
          idx === i ? { ...t, pricesByColumn: { ...t.pricesByColumn, [columnId]: value } } : t
        ),
      });
    }
    function addTier() {
      const last = draft.pricingTiers[draft.pricingTiers.length - 1];
      apply({
        pricingTiers: [
          ...draft.pricingTiers,
          {
            minQty: last ? last.minQty + 12 : 1,
            pricePerUnit: last?.pricePerUnit ?? 0,
            pricesByColumn: last?.pricesByColumn,
          },
        ],
      });
    }
    function removeTier(i: number) {
      apply({ pricingTiers: draft.pricingTiers.filter((_, idx) => idx !== i) });
    }
    function addColumn() {
      const label = prompt("Column label (e.g. \"Up to 5,000 stitches\")");
      if (!label || !label.trim()) return;
      const column: PriceColumn = { id: uuid(), label: label.trim() };
      apply({ priceColumns: [...columns, column] });
    }
    function renameColumn(id: string) {
      const current = columns.find((c) => c.id === id);
      const label = prompt("Column label", current?.label ?? "");
      if (!label || !label.trim()) return;
      apply({ priceColumns: columns.map((c) => (c.id === id ? { ...c, label: label.trim() } : c)) });
    }
    function removeColumn(id: string) {
      apply({
        priceColumns: columns.filter((c) => c.id !== id),
        pricingTiers: draft.pricingTiers.map((t) => {
          if (!t.pricesByColumn) return t;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [id]: _removed, ...rest } = t.pricesByColumn;
          return { ...t, pricesByColumn: rest };
        }),
      });
    }

    return (
      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <div className="text-xs font-medium text-navy/60 uppercase tracking-wide">
            Quantity price breaks
          </div>
          {hasColumns && (
            <div className="text-xs text-navy/40">Priced per {columns.length > 1 ? "column" : "the column"} below</div>
          )}
        </div>

        {!hasColumns ? (
          <div className="mt-2 space-y-2">
            {draft.pricingTiers.map((tier, i) => (
              <div key={i} className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-navy/60">
                  Qty ≥
                  <input
                    type="number"
                    min={1}
                    value={tier.minQty}
                    onChange={(e) => updateTier(i, "minQty", Math.max(1, Number(e.target.value) || 1))}
                    className="w-20 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-navy/60">
                  $/unit
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={tier.pricePerUnit}
                    onChange={(e) => updateTier(i, "pricePerUnit", Math.max(0, Number(e.target.value) || 0))}
                    className="w-24 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                  />
                </label>
                <span className="text-xs text-navy/40">
                  {formatUSD(tier.pricePerUnit)}/unit at {tier.minQty}+
                </span>
                <button
                  onClick={() => removeTier(i)}
                  disabled={draft.pricingTiers.length <= 1}
                  className="ml-auto text-xs text-red-600 hover:underline disabled:text-navy/20 disabled:no-underline"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-xs font-medium text-navy/60 pr-3 pb-2">Qty ≥</th>
                  {columns.map((col) => (
                    <th key={col.id} className="text-left text-xs font-medium text-navy/60 px-2 pb-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => renameColumn(col.id)}
                          className="hover:underline text-left"
                          title="Rename column"
                        >
                          {col.label}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeColumn(col.id)}
                          className="text-red-600 hover:underline text-[11px]"
                          title="Remove column"
                        >
                          (remove)
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {draft.pricingTiers.map((tier, i) => (
                  <tr key={i}>
                    <td className="pr-3 pb-2 align-top">
                      <input
                        type="number"
                        min={1}
                        value={tier.minQty}
                        onChange={(e) => updateTier(i, "minQty", Math.max(1, Number(e.target.value) || 1))}
                        className="w-20 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                      />
                    </td>
                    {columns.map((col) => (
                      <td key={col.id} className="px-2 pb-2 align-top">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={tier.pricesByColumn?.[col.id] ?? tier.pricePerUnit}
                          onChange={(e) => updateCellPrice(i, col.id, Math.max(0, Number(e.target.value) || 0))}
                          className="w-24 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                        />
                      </td>
                    ))}
                    <td className="pb-2 align-top">
                      <button
                        onClick={() => removeTier(i)}
                        disabled={draft.pricingTiers.length <= 1}
                        className="text-xs text-red-600 hover:underline disabled:text-navy/20 disabled:no-underline"
                      >
                        Remove row
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-navy/40">
              A blank cell falls back to that row&apos;s base $/unit until you set one.
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={addTier}
            className="text-sm px-3 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5"
          >
            + Add {hasColumns ? "row" : "tier"}
          </button>
          <button
            onClick={addColumn}
            className="text-sm px-3 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5"
          >
            + Add column
          </button>
          {!hasColumns && (
            <span className="text-xs text-navy/40">
              Add a column to price this decoration differently by, e.g., embroidery stitch count.
            </span>
          )}
        </div>
      </div>
    );
  }

  function draftFields(draft: Draft, apply: (patch: Partial<Draft>) => void) {
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm text-navy/70">
            Short label (shown in lists)
            <input
              type="text"
              value={draft.shortLabel}
              onChange={(e) => apply({ shortLabel: e.target.value })}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm text-navy/70">
            Full label
            <input
              type="text"
              value={draft.label}
              onChange={(e) => apply({ label: e.target.value })}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <label className="mt-3 block text-sm text-navy/70">
          Description
          <textarea
            value={draft.description}
            onChange={(e) => apply({ description: e.target.value })}
            rows={2}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>

        <div className="mt-3 flex items-center gap-4 text-sm text-navy/70">
          <span className="font-medium text-navy">Available on</span>
          {(["hat", "shirt"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5 capitalize">
              <input
                type="checkbox"
                checked={draft.productTypes.includes(t)}
                onChange={(e) => toggleProductType(draft, t, e.target.checked, apply)}
              />
              {t}s
            </label>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm text-navy/70">
            Accepted file types (comma separated)
            <input
              type="text"
              value={draft.acceptedFileTypesText}
              onChange={(e) => apply({ acceptedFileTypesText: e.target.value })}
              placeholder=".png, .jpg, .pdf, .ai, .svg"
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm text-navy/70">
            Turnaround
            <input
              type="text"
              value={draft.turnaroundDays}
              onChange={(e) => apply({ turnaroundDays: e.target.value })}
              placeholder="e.g. 10-12 business days"
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <div className="mt-4 pt-3 border-t border-navy/10">
          <label className="flex items-center gap-1.5 text-sm text-navy/70 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={draft.quoteRequired === true}
              onChange={(e) => apply({ quoteRequired: e.target.checked })}
            />
            Requires a custom quote — no automatic price
          </label>
          <p className="mt-1 text-xs text-navy/50">
            Customers can still pick this decoration and place their order, but it&apos;s
            never priced automatically — they&apos;re told we&apos;ll follow up with a
            quote. Use this when cost depends on something we have to look at case by
            case (e.g. embroidery stitch count).
          </p>
        </div>

        {draft.quoteRequired ? (
          <p className="mt-3 text-xs text-navy/50 bg-navy/[0.03] border border-navy/10 rounded-lg px-3 py-2">
            Setup fee and pricing tiers are hidden while &quot;Requires a custom quote&quot;
            is on — turn it off to price this decoration automatically again.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-4 max-w-md">
              <label className="flex items-center gap-2 text-sm text-navy/70">
                <span className="whitespace-nowrap">Setup / digitization fee ($)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.setupFee}
                  disabled={draft.setupFeeEnabled === false}
                  onChange={(e) => apply({ setupFee: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-24 border border-navy/20 rounded-lg px-2 py-1 text-sm disabled:bg-navy/5 disabled:text-navy/30"
                />
              </label>
              <label className="flex items-center gap-1.5 text-sm text-navy/70 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={draft.setupFeeEnabled !== false}
                  onChange={(e) => apply({ setupFeeEnabled: e.target.checked })}
                />
                Charge this fee
              </label>
            </div>
            {draft.setupFeeEnabled === false && (
              <p className="mt-1 text-xs text-navy/50">
                Setup fee is off — orders for this decoration type will never be charged one,
                regardless of quantity. The amount above is kept so you can turn it back on later.
              </p>
            )}

            {tierRows(draft, apply)}
          </>
        )}
      </>
    );
  }

  async function handleSaveExisting(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/decoration-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...fromDraft(draft) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMessage(data.persisted ? "Saved." : "Saved for now — no durable storage connected, see note above.");
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/decoration-types?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setOpenId(null);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreate() {
    setSavingId("__new__");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/decoration-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fromDraft(newDraft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      setCreating(false);
      setNewDraft(BLANK_DRAFT);
      setMessage(data.persisted ? "Added." : "Added for now — no durable storage connected, see note above.");
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <p className="text-navy/40 text-sm">Loading…</p>;
  }

  return (
    <div>
      {!persistent && (
        <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No durable storage is connected to this deployment yet, so changes
          only last until the next cold start or redeploy. Connect a Vercel
          Blob store to this project (Vercel dashboard → Storage → Create
          Database → Blob → Connect to Project) to make changes stick.
        </p>
      )}

      <div className="space-y-4">
        {decorations.map((d) => {
          const draft = drafts[d.id] ?? toDraft(d);
          const isOpen = openId === d.id;
          return (
            <div key={d.id} className="border border-navy/10 rounded-xl bg-white overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <div className="flex-1">
                  <div className="font-semibold text-navy">{d.shortLabel}</div>
                  <div className="text-xs text-navy/50 mt-0.5">
                    {d.productTypes.map((t) => (t === "hat" ? "Hats" : "Shirts")).join(" · ")}
                    {" · "}
                    {d.quoteRequired ? (
                      "Custom quote — no automatic price"
                    ) : (
                      <>
                        {formatUSD(d.pricingTiers[0]?.pricePerUnit ?? 0)}/unit at {d.pricingTiers[0]?.minQty ?? 0}+
                        {" · "}
                        {d.setupFeeEnabled === false
                          ? "no setup fee"
                          : `${formatUSD(d.setupFee)} setup fee`}
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setOpenId(isOpen ? null : d.id)}
                  className="text-sm text-navy/70 px-3 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5"
                >
                  {isOpen ? "Close" : "Edit"}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${d.shortLabel}"? Items currently using it will just stop offering it.`)) {
                      handleDelete(d.id);
                    }
                  }}
                  disabled={savingId === d.id}
                  className="text-sm text-red-600 px-2 hover:underline disabled:text-navy/20"
                >
                  Delete
                </button>
              </div>

              {isOpen && (
                <div className="p-4 border-t border-navy/10 bg-navy/[0.02]">
                  {draftFields(draft, (patch) => updateDraft(d.id, patch))}
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={() => handleSaveExisting(d.id)}
                      disabled={savingId === d.id}
                      className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
                    >
                      {savingId === d.id ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 border border-dashed border-navy/20 rounded-xl">
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            className="w-full p-4 text-sm font-medium text-navy/70 hover:bg-navy/5 rounded-xl"
          >
            + Add a decoration type
          </button>
        ) : (
          <div className="p-4">
            <h3 className="font-semibold text-navy">New decoration type</h3>
            {draftFields(newDraft, (patch) => setNewDraft((prev) => ({ ...prev, ...patch })))}
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleCreate}
                disabled={savingId === "__new__" || !newDraft.label || !newDraft.shortLabel}
                className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
              >
                {savingId === "__new__" ? "Adding…" : "Add decoration type"}
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setNewDraft(BLANK_DRAFT);
                }}
                className="px-4 py-2 rounded-full border border-navy/20 text-sm font-medium hover:bg-navy/5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {message && <p className="mt-4 text-sm text-navy/70">{message}</p>}
    </div>
  );
}
