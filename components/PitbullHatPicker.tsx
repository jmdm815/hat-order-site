"use client";

import { useEffect, useRef, useState } from "react";
import type { GarmentMarkupBreakpoint } from "@/lib/types";
import type { QuoteLineInput } from "@/lib/quote";
import { getMarkupPercentForCost } from "@/lib/garment-markup";

// Quote builder → Catalog "Pitbull Cap (hats)". Looks a style up on
// pitbullcap.com (name, colors, photos), uses JM's saved wholesale price
// (signed-in account price, not the public retail price), auto-fills the
// markup from the Garment Markup table, and adds one hat line per color.
// Lines are shop-priced custom hat lines (manualSource "custom", itemType
// "hat"), so they save, price and print like any other custom hat.

type Color = { name: string; sku: string; available: boolean; imageUrl?: string };
type Product = { style: string; title: string; brand: string; publicPrice: number; imageUrl?: string; url: string; colors: Color[] };
type Suggestion = { style: string; title: string; handle: string; imageUrl?: string; wholesale: number | null };

export type PitbullLine = QuoteLineInput & { key: string; brandName: string; productName: string; imageUrl?: string };

export default function PitbullHatPicker({
  markupBreakpoints,
  decorationId,
  priceColumnId,
  taxable,
  onAdd,
}: {
  markupBreakpoints: GarmentMarkupBreakpoint[];
  decorationId?: string;
  priceColumnId?: string;
  taxable: boolean;
  onAdd: (lines: PitbullLine[]) => void;
}) {
  const [q, setQ] = useState("");
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState("");
  const [savedCost, setSavedCost] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [markup, setMarkup] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null);

  const costNum = Number(cost);
  const costOk = cost !== "" && costNum > 0;

  useEffect(() => {
    return () => {
      if (deb.current) clearTimeout(deb.current);
    };
  }, []);

  function onQuery(v: string) {
    setQ(v);
    if (deb.current) clearTimeout(deb.current);
    if (v.trim().length < 2) {
      setSugs([]);
      return;
    }
    deb.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/pitbull/search?q=${encodeURIComponent(v.trim())}`);
        const d = await r.json();
        setSugs(d.results ?? []);
        setOpen(true);
      } catch {
        setSugs([]);
      }
    }, 300);
  }

  async function load(style: string) {
    setOpen(false);
    setLoading(true);
    setError(null);
    setProduct(null);
    setQty({});
    try {
      const r = await fetch(`/api/admin/pitbull/product?style=${encodeURIComponent(style)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Not found");
      setProduct(d.product);
      setQ(d.product.style);
      const w = d.wholesale?.price ?? null;
      setSavedCost(w);
      setSavedAt(d.wholesale?.updatedAt ?? null);
      setCost(w != null ? String(w) : "");
      setMarkup(w != null ? String(getMarkupPercentForCost(markupBreakpoints, w)) : "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }

  function onCost(v: string) {
    setCost(v);
    const n = Number(v);
    if (v !== "" && n > 0) setMarkup(String(getMarkupPercentForCost(markupBreakpoints, n)));
  }

  async function saveCost() {
    if (!product || !costOk) return;
    setSaving(true);
    try {
      const r = await fetch("/api/admin/pitbull/prices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prices: { [product.style]: costNum }, note: "set in quote builder" }),
      });
      if (r.ok) {
        setSavedCost(costNum);
        setSavedAt(new Date().toISOString());
      }
    } finally {
      setSaving(false);
    }
  }

  function add() {
    if (!product) return;
    if (!costOk) {
      setError("Enter your Pitbull Cap wholesale cost first (the price you see signed in).");
      return;
    }
    const picked = product.colors.filter((c) => (qty[c.name] ?? 0) > 0);
    if (!picked.length) {
      setError("Enter a quantity for at least one color.");
      return;
    }
    const m = Number(markup) || 0;
    const brand = `Pitbull Cap${product.brand && !/pitbull/i.test(product.brand) ? ` (${product.brand.charAt(0) + product.brand.slice(1).toLowerCase()})` : ""}`;
    const productName = product.title.replace(new RegExp(`^${product.style}\\s*`, "i"), "").trim() || product.title;
    const lines: PitbullLine[] = picked.map((c, i) => ({
      key: `pitbull-${Date.now()}-${i}`,
      customerSupplied: true,
      manualSource: "custom",
      itemType: "hat",
      itemDescription: productName,
      brandNameInput: brand,
      styleNumber: product.style,
      colorName: c.name,
      sizes: [{ size: "OSFA", quantity: qty[c.name], garmentCost: costNum, garmentMarkupPercent: m }],
      decorationId: decorationId || undefined,
      priceColumnId: priceColumnId || undefined,
      taxable,
      brandName: brand,
      productName,
      imageUrl: c.imageUrl ?? product.imageUrl,
    }));
    onAdd(lines);
    setQty({});
    setError(null);
  }

  const total = Object.values(qty).reduce((n, v) => n + (v || 0), 0);
  const unit = costOk ? Math.round(costNum * (1 + (Number(markup) || 0) / 100) * 100) / 100 : null;
  const shown = product?.colors.filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase())) ?? [];
  const input = "border border-admin-ink/20 rounded-xl px-2 py-1.5 text-sm";

  return (
    <div className="mt-4 border-t border-admin-ink/10 pt-4 max-w-3xl">
      <div className="relative max-w-xl">
        <label className="text-xs text-admin-ink/80">
          Pitbull Cap style
          <input
            value={q}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && q.trim() && load(q.trim())}
            onFocus={() => sugs.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Style number or name — e.g. PB311"
            className={`mt-1 w-full ${input}`}
          />
        </label>
        {open && sugs.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-xl border border-admin-ink/15 bg-admin-card shadow-lg">
            {sugs.map((s) => (
              <li key={s.handle}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => load(s.handle)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-admin-ink/5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- supplier CDN photo */}
                  {s.imageUrl && <img src={s.imageUrl} alt="" className="h-8 w-8 rounded object-contain" />}
                  <span className="flex-1">{s.title}</span>
                  <span className="text-xs text-admin-ink/60">{s.wholesale != null ? `$${s.wholesale.toFixed(2)}` : "no cost saved"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loading && <p className="mt-3 text-sm text-admin-ink/70">Looking up on pitbullcap.com…</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {product && (
        <div className="mt-4">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- supplier CDN photo */}
            {product.imageUrl && <img src={product.imageUrl} alt="" className="h-16 w-16 rounded-lg object-contain border border-admin-ink/10" />}
            <div className="text-sm">
              <a href={product.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                {product.title}
              </a>
              <p className="text-xs text-admin-ink/60">
                {product.brand} · {product.colors.length} colors · public price ${product.publicPrice.toFixed(2)} (not your cost)
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs text-admin-ink/80">
              Your cost (wholesale)
              <input value={cost} onChange={(e) => onCost(e.target.value)} inputMode="decimal" className={`mt-1 block w-28 ${input}`} placeholder="e.g. 7.50" />
            </label>
            <label className="text-xs text-admin-ink/80">
              Markup %
              <input value={markup} onChange={(e) => setMarkup(e.target.value)} inputMode="decimal" className={`mt-1 block w-20 ${input}`} />
            </label>
            <div className="text-xs text-admin-ink/70 pb-2">
              Hat price {unit != null ? <b className="text-admin-ink">${unit.toFixed(2)}</b> : "—"} + decoration
            </div>
            {costOk && savedCost !== costNum && (
              <button type="button" onClick={saveCost} disabled={saving} className="mb-0.5 text-xs px-3 py-1.5 rounded-xl border border-admin-ink/25">
                {saving ? "Saving…" : `Save $${costNum.toFixed(2)} as ${product.style} cost`}
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-admin-ink/55">
            {savedCost != null
              ? `Saved cost $${savedCost.toFixed(2)}${savedAt ? `, updated ${new Date(savedAt).toLocaleDateString()}` : ""}.`
              : "No cost saved for this style yet — enter the price you see signed in to pitbullcap.com."}
          </p>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-admin-ink/80 uppercase tracking-wide">Colors & quantities</span>
            {product.colors.length > 8 && (
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter colors" className={`w-40 ${input}`} />
            )}
          </div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {shown.map((c) => (
              <label key={c.name} className="flex items-center gap-2 rounded-xl border border-admin-ink/10 px-2 py-1.5 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element -- supplier CDN photo */}
                {c.imageUrl ? <img src={c.imageUrl} alt="" className="h-8 w-8 rounded object-contain" /> : <span className="h-8 w-8" />}
                <span className="flex-1">
                  {c.name}
                  {!c.available && <span className="ml-1 text-[11px] text-amber-700">sold out online</span>}
                </span>
                <input
                  type="number"
                  min={0}
                  value={qty[c.name] || ""}
                  onChange={(e) => setQty((p) => ({ ...p, [c.name]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                  className={`w-20 ${input}`}
                  placeholder="0"
                />
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={add}
            className="mt-4 text-sm px-4 py-1.5 rounded-xl bg-admin-accent text-admin-accent-ink hover:bg-admin-accent/90"
          >
            Add {total > 0 ? `${total} hat${total === 1 ? "" : "s"}` : "to quote"}
          </button>
          <p className="mt-2 text-[11px] text-admin-ink/55">
            &quot;Sold out online&quot; can be wrong for a single warehouse — Houston/LA stock shows only when signed in.
          </p>
        </div>
      )}
    </div>
  );
}
