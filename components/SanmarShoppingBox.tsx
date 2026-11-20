"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// What's actually in the sanmar.com shopping box right now, read by the
// server's SanMar sign-in. Shows the last read instantly; "Refresh" reads
// sanmar.com again (~20s). Lines can be removed here (same as the ✕ on
// sanmar.com). Never empties the whole box and never checks out.

type Line = {
  id: string;
  sku: string;
  style: string;
  color: string;
  size: string;
  qty: number;
  unitPrice: number | null;
  total: number | null;
  warehouse: string;
  backorder: boolean;
};
export type ShoppingBoxLineView = Line;
type Box = { lines: Line[]; count: number; subtotal: number | null; readAt: string };

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "XXL", "3XL", "4XL", "5XL", "6XL", "OSFA"];
const rank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toUpperCase());
  return i === -1 ? 50 : i;
};
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function SanmarShoppingBox({
  refreshKey = 0,
  onBox,
}: {
  refreshKey?: number;
  onBox?: (lines: Line[] | null) => void;
}) {
  const [box, setBox] = useState<Box | null>(null);
  const [loading, setLoading] = useState<"cached" | "refresh" | "remove" | null>("cached");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Tell the page what's in the box so the order list can sort itself.
  useEffect(() => {
    if (loading !== "cached") onBox?.(box?.lines ?? null);
  }, [box, loading, onBox]);

  const refresh = useCallback(async () => {
    setLoading("refresh");
    setError(null);
    setNote(null);
    try {
      const r = await fetch("/api/admin/sanmar-order/box?refresh=1");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't read the shopping box");
      setBox(d.box);
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the shopping box");
    } finally {
      setLoading(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/sanmar-order/box")
      .then((r) => r.json())
      .then((d) => !cancelled && setBox(d.box ?? null))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(null));
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-read after the order list was just sent to the box.
  useEffect(() => {
    if (refreshKey <= 0) return;
    const t = setTimeout(refresh, 0);
    return () => clearTimeout(t);
  }, [refreshKey, refresh]);

  async function remove(ids: string[]) {
    if (!box || !ids.length) return;
    const names = box.lines
      .filter((l) => ids.includes(l.id))
      .map((l) => `${l.style} ${l.color} ${l.size} ×${l.qty}`);
    if (!confirm(`Remove from your SanMar shopping box?\n\n${names.join("\n")}`)) return;
    setLoading("remove");
    setError(null);
    setNote(null);
    try {
      const r = await fetch("/api/admin/sanmar-order/box", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setBox(d.box);
      setPicked(new Set());
      const bits = [`Removed ${d.removed.length} line${d.removed.length === 1 ? "" : "s"}.`];
      if (d.notFound?.length) bits.push(`${d.notFound.length} were already gone.`);
      if (d.failed?.length) bits.push(`Couldn't remove: ${d.failed.join("; ")}`);
      setNote(bits.join(" "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove");
    } finally {
      setLoading(null);
    }
  }

  const groups = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of box?.lines ?? []) {
      const k = `${l.style}|${l.color}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    }
    return Array.from(m.values()).map((ls) => ls.sort((a, b) => rank(a.size) - rank(b.size)));
  }, [box]);

  const card = "bg-admin-card border border-admin-ink/15 rounded-2xl p-4 sm:p-5";
  const btn = "px-3 py-1.5 rounded-xl text-sm font-medium disabled:opacity-50";
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="font-heading font-semibold uppercase tracking-wide">SanMar shopping box</h2>
          <p className="text-xs text-admin-ink/70">
            {box
              ? `${box.count} items · ${money(box.subtotal)} · read ${when(box.readAt)}`
              : loading === "cached"
                ? "Loading…"
                : "Not read yet — refresh to see what's in your sanmar.com box."}
          </p>
        </div>
        <div className="flex gap-2">
          {picked.size > 0 && (
            <button className={`${btn} border border-red-300 text-red-700`} disabled={!!loading} onClick={() => remove(Array.from(picked))}>
              {loading === "remove" ? "Removing…" : `Remove ${picked.size} selected`}
            </button>
          )}
          <button className={`${btn} border border-admin-ink/25`} disabled={!!loading} onClick={refresh}>
            {loading === "refresh" ? "Reading sanmar.com… (~20s)" : "Refresh from SanMar"}
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
      {note && <p className="mb-3 text-sm text-green-900 bg-green-50 rounded-xl px-3 py-2">{note}</p>}

      {box && box.lines.length === 0 && <p className="text-sm text-admin-ink/70">The shopping box is empty.</p>}
      {groups.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-admin-ink/60 border-b border-admin-ink/10">
                <th className="py-1.5 pr-2 w-6"></th>
                <th className="py-1.5 pr-3">Style</th>
                <th className="py-1.5 pr-3">Color</th>
                <th className="py-1.5 pr-3">Size</th>
                <th className="py-1.5 pr-3 text-right">Qty</th>
                <th className="py-1.5 pr-3 text-right">Each</th>
                <th className="py-1.5 pr-3 text-right">Total</th>
                <th className="py-1.5 pr-3">Warehouse</th>
                <th className="py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((ls, gi) =>
                ls.map((l, i) => (
                  <tr key={l.id} className={`${i === 0 && gi > 0 ? "border-t border-admin-ink/10" : ""} ${picked.has(l.id) ? "bg-red-50" : ""}`}>
                    <td className="py-1.5 pr-2">
                      <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} disabled={!!loading} aria-label={`Select ${l.style} ${l.color} ${l.size}`} />
                    </td>
                    <td className="py-1.5 pr-3 font-semibold">{i === 0 ? l.style : ""}</td>
                    <td className="py-1.5 pr-3">{i === 0 ? l.color : ""}</td>
                    <td className="py-1.5 pr-3">{l.size}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{l.qty}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(l.unitPrice)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(l.total)}</td>
                    <td className="py-1.5 pr-3 text-admin-ink/80">
                      {l.warehouse}
                      {l.backorder && <span className="ml-1 text-[11px] text-amber-700">backorder</span>}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        className="text-red-600 hover:text-red-800 disabled:opacity-40 px-1"
                        disabled={!!loading}
                        onClick={() => remove([l.id])}
                        aria-label={`Remove ${l.style} ${l.color} ${l.size}`}
                        title="Remove from shopping box"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
