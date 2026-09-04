"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { CatalogItemConfig, Product, ProductCategory, ProductType } from "@/lib/types";
import { formatUSD } from "@/lib/pricing";
import { productImageUrl } from "@/lib/product-image";
import AdminItemConfigEditor from "./AdminItemConfigEditor";
import AdminCustomProductForm from "./AdminCustomProductForm";

const HAT_CATEGORIES: ProductCategory[] = [
  "Trucker",
  "Structured",
  "Unstructured",
  "Dad Hat",
  "Visor",
  "Beanie",
];
const SHIRT_CATEGORIES: ProductCategory[] = ["T-Shirt", "Long Sleeve", "Tank", "Youth Tee"];
const TUMBLER_CATEGORIES: ProductCategory[] = ["Tumbler"];

function productTypeLabel(t: ProductType | "all"): string {
  if (t === "all") return "All";
  if (t === "hat") return "Hats";
  if (t === "shirt") return "Shirts";
  return "Tumblers";
}

type ApiResponse = {
  styles: Product[];
  hidden: string[];
  persistent: boolean;
};

type ItemConfigApiResponse = {
  configs: Record<string, CatalogItemConfig>;
  persistent: boolean;
};

export default function AdminCatalogManager() {
  const router = useRouter();
  const [styles, setStyles] = useState<Product[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [savedHidden, setSavedHidden] = useState<Set<string>>(new Set());
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [productType, setProductType] = useState<ProductType | "all">("all");
  const [category, setCategory] = useState<string>("All");
  const [visibilityFilter, setVisibilityFilter] = useState<
    "all" | "visible" | "hidden"
  >("all");
  const [itemConfigs, setItemConfigs] = useState<Record<string, CatalogItemConfig>>({});
  const [configTarget, setConfigTarget] = useState<Product | null>(null);
  const [customProductForm, setCustomProductForm] = useState<
    { mode: "add" } | { mode: "edit"; product: Product } | null
  >(null);

  function load() {
    Promise.all([
      fetch("/api/admin/catalog").then((r) => {
        if (r.status === 401) throw new Error("unauthorized");
        return r.json();
      }),
      fetch("/api/admin/item-config").then((r) => (r.ok ? r.json() : { configs: {} })),
    ])
      .then(([catalogData, configData]: [ApiResponse, ItemConfigApiResponse]) => {
        setStyles(catalogData.styles);
        setHidden(new Set(catalogData.hidden));
        setSavedHidden(new Set(catalogData.hidden));
        setPersistent(catalogData.persistent);
        setItemConfigs(configData.configs ?? {});
      })
      .catch(() => router.refresh())
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleDeleteCustomProduct(product: Product) {
    if (!confirm(`Delete "${product.productName}"? This can't be undone.`)) return;
    const res = await fetch(`/api/admin/custom-products?id=${encodeURIComponent(product.styleNumber)}`, {
      method: "DELETE",
    });
    if (res.ok) load();
  }

  const categoryOptions =
    productType === "hat"
      ? HAT_CATEGORIES
      : productType === "shirt"
        ? SHIRT_CATEGORIES
        : productType === "tumbler"
          ? TUMBLER_CATEGORIES
          : [...HAT_CATEGORIES, ...SHIRT_CATEGORIES, ...TUMBLER_CATEGORIES];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return styles.filter((s) => {
      if (productType !== "all" && s.productType !== productType) return false;
      if (category !== "All" && s.category !== category) return false;
      if (visibilityFilter === "visible" && hidden.has(s.styleNumber)) return false;
      if (visibilityFilter === "hidden" && !hidden.has(s.styleNumber)) return false;
      if (!q) return true;
      return (
        s.productName.toLowerCase().includes(q) ||
        s.brandName.toLowerCase().includes(q) ||
        s.styleNumber.toLowerCase().includes(q)
      );
    });
  }, [styles, search, productType, category, visibilityFilter, hidden]);

  const dirty = useMemo(() => {
    if (hidden.size !== savedHidden.size) return true;
    for (const id of hidden) if (!savedHidden.has(id)) return true;
    return false;
  }, [hidden, savedHidden]);

  function toggle(styleNumber: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(styleNumber)) next.delete(styleNumber);
      else next.add(styleNumber);
      return next;
    });
  }

  function setAllFiltered(visible: boolean) {
    setHidden((prev) => {
      const next = new Set(prev);
      for (const s of filtered) {
        if (visible) next.delete(s.styleNumber);
        else next.add(s.styleNumber);
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/admin/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: Array.from(hidden) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setSavedHidden(new Set(hidden));
      setSaveMessage(
        data.persisted
          ? "Saved."
          : "Saved for now, but this deployment has no durable storage connected — changes will reset on redeploy. See the note above."
      );
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-navy/40 text-sm">Loading catalog…</p>;
  }

  return (
    <div>
      {!persistent && (
        <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No durable storage is connected to this deployment yet, so
          check/uncheck changes only last until the next cold start or
          redeploy. Connect a Vercel Blob store to this project (Vercel
          dashboard → Storage → Create Database → Blob → Connect to Project)
          to make changes stick.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 sticky top-[57px] bg-cream/95 backdrop-blur py-3 z-10 border-b border-navy/10">
        <input
          type="text"
          placeholder="Search brand, name, or style #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-navy/20 rounded-lg px-3 py-2 text-sm w-64"
        />
        <div className="flex gap-1">
          {(["all", "hat", "shirt", "tumbler"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setProductType(t);
                setCategory("All");
              }}
              className={`px-3 py-2 text-sm rounded-lg border capitalize ${
                productType === t
                  ? "bg-navy text-white border-navy"
                  : "border-navy/20 text-navy/70 hover:bg-navy/5"
              }`}
            >
              {productTypeLabel(t)}
            </button>
          ))}
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="border border-navy/20 rounded-lg px-3 py-2 text-sm"
        >
          <option value="All">All</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={visibilityFilter}
          onChange={(e) => setVisibilityFilter(e.target.value as typeof visibilityFilter)}
          className="border border-navy/20 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All</option>
          <option value="visible">Visible only</option>
          <option value="hidden">Hidden only</option>
        </select>
        <button
          onClick={() => setAllFiltered(true)}
          className="text-sm px-3 py-2 rounded-lg border border-navy/20 hover:bg-navy/5"
        >
          Show all filtered
        </button>
        <button
          onClick={() => setAllFiltered(false)}
          className="text-sm px-3 py-2 rounded-lg border border-navy/20 hover:bg-navy/5"
        >
          Hide all filtered
        </button>
        <button
          onClick={() => setCustomProductForm({ mode: "add" })}
          className="text-sm px-3 py-2 rounded-lg border border-navy/20 hover:bg-navy/5 font-medium text-navy"
        >
          + Add custom product
        </button>
        <span className="text-sm text-navy/60 ml-auto">
          {filtered.length} shown · {styles.length - hidden.size} visible of{" "}
          {styles.length} total
        </span>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-5 py-2 rounded-full bg-red text-white font-semibold hover:bg-navy transition disabled:bg-navy/20"
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>
      {saveMessage && (
        <p className="mt-2 text-sm text-navy/70">{saveMessage}</p>
      )}

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {filtered.map((s) => {
          const isHidden = hidden.has(s.styleNumber);
          return (
            <div
              key={s.styleNumber}
              className={`border rounded-xl bg-white overflow-hidden transition ${
                isHidden ? "border-navy/10 opacity-45" : "border-navy/10 hover:shadow-md"
              }`}
            >
              <label className="block cursor-pointer">
                <div className="relative w-full aspect-square bg-white p-3">
                  <Image
                    src={
                      s.heroImageIsOverride
                        ? s.heroImageUrl
                        : productImageUrl(s.heroImageUrl, s.heroImageFallbackUrl)
                    }
                    alt={s.productName}
                    fill
                    unoptimized
                    className="object-contain"
                    sizes="200px"
                  />
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={() => toggle(s.styleNumber)}
                    className="absolute top-2 left-2 w-5 h-5 accent-red"
                  />
                  <span className="absolute top-2 right-2 flex gap-1">
                    {s.isCustom && (
                      <span className="text-[10px] uppercase tracking-wide bg-red text-white px-1.5 py-0.5 rounded">
                        Custom
                      </span>
                    )}
                    <span className="text-[10px] uppercase tracking-wide bg-navy/80 text-white px-1.5 py-0.5 rounded">
                      {s.productType}
                    </span>
                  </span>
                </div>
                <div className="p-2.5 pb-1.5">
                  <div className="text-[11px] uppercase tracking-wide text-navy/40 truncate">
                    {s.brandName} · {s.styleNumber}
                  </div>
                  <div className="text-xs font-semibold text-navy leading-tight line-clamp-2 mt-0.5">
                    {s.productName}
                  </div>
                  <div className="text-xs text-navy/60 mt-1">
                    {formatUSD(s.basePrice)} · {s.category}
                  </div>
                </div>
              </label>
              <button
                onClick={() => setConfigTarget(s)}
                className="w-full text-[11px] font-medium text-navy/70 border-t border-navy/10 py-1.5 hover:bg-navy/5"
              >
                Configure decorations
              </button>
              {s.isCustom && (
                <div className="flex border-t border-navy/10">
                  <button
                    onClick={() => setCustomProductForm({ mode: "edit", product: s })}
                    className="flex-1 text-[11px] font-medium text-navy/70 py-1.5 hover:bg-navy/5"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteCustomProduct(s)}
                    className="flex-1 text-[11px] font-medium text-red-600 border-l border-navy/10 py-1.5 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {configTarget && (
        <AdminItemConfigEditor
          product={configTarget}
          initialConfig={itemConfigs[configTarget.styleNumber]}
          onClose={() => setConfigTarget(null)}
          onSaved={(config) => {
            setItemConfigs((prev) => ({ ...prev, [configTarget.styleNumber]: config }));
            setConfigTarget(null);
          }}
        />
      )}

      {customProductForm && (
        <AdminCustomProductForm
          editing={customProductForm.mode === "edit" ? customProductForm.product : null}
          onClose={() => setCustomProductForm(null)}
          onSaved={() => {
            setCustomProductForm(null);
            load();
          }}
        />
      )}
    </div>
  );
}
