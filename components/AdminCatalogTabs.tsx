"use client";

import { useEffect, useState } from "react";
import type { ProductType } from "@/lib/types";

// Admin → Catalog: show/hide the product-type tabs on the customer catalog.
const TABS: { id: ProductType; label: string }[] = [
  { id: "hat", label: "Hats" },
  { id: "shirt", label: "T-Shirts" },
  { id: "polo", label: "Polos" },
  { id: "tumbler", label: "Tumblers" },
];

export default function AdminCatalogTabs() {
  const [hidden, setHidden] = useState<ProductType[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/catalog-tabs")
      .then((r) => r.json())
      .then((j) => alive && setHidden(j.hidden ?? []))
      .catch(() => alive && setHidden([]));
    for (const t of TABS) {
      fetch(`/api/catalog?type=${t.id}`)
        .then((r) => r.json())
        .then((items) => alive && Array.isArray(items) && setCounts((c) => ({ ...c, [t.id]: items.length })))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(id: ProductType) {
    if (!hidden) return;
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    if (next.length >= TABS.length) {
      setError("At least one tab has to stay visible.");
      return;
    }
    setError(null);
    setSaving(true);
    setHidden(next);
    try {
      const res = await fetch("/api/admin/catalog-tabs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't save");
      setHidden(j.hidden);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6 border border-admin-ink/12 rounded-2xl bg-admin-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-admin-ink">Catalog tabs</h2>
        <p className="text-xs text-admin-ink/60">{saving ? "Saving…" : "Choose which tabs customers see on the catalog page."}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const shown = hidden ? !hidden.includes(t.id) : true;
          return (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              disabled={!hidden || saving}
              aria-pressed={shown}
              className={`flex items-center gap-2.5 pl-2 pr-3.5 py-1.5 rounded-full border text-sm transition ${
                shown ? "border-admin-ink/25 text-admin-ink" : "border-admin-ink/15 text-admin-ink/45 bg-admin-ink/[0.03]"
              }`}
            >
              <span className={`relative w-8 h-[18px] rounded-full transition ${shown ? "bg-green-600" : "bg-admin-ink/25"}`}>
                <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${shown ? "left-[16px]" : "left-[2px]"}`} />
              </span>
              <span className="font-medium">{t.label}</span>
              <span className="text-xs text-admin-ink/50">
                {counts[t.id] === undefined ? "" : `${counts[t.id]} item${counts[t.id] === 1 ? "" : "s"}`}
                {shown ? "" : " · hidden"}
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
