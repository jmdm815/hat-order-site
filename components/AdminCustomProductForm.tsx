"use client";

import { useState } from "react";
import { v4 as uuid } from "uuid";
import { Product, ProductColor, ProductSize, ProductType } from "@/lib/types";

type ColorDraft = {
  colorName: string;
  colorHex: string;
  imageUrl: string;
  backImageUrl: string;
  uploadingFront: boolean;
  uploadingBack: boolean;
};

type Draft = {
  productType: ProductType;
  productName: string;
  brandName: string;
  description: string;
  category: string;
  basePrice: string; // kept as text while editing, parsed on save
  hasSizes: boolean;
  sizes: { name: string; price: string; inventory: string }[];
  colors: ColorDraft[];
};

const CATEGORY_SUGGESTIONS: Record<ProductType, string[]> = {
  hat: ["Trucker", "Structured", "Unstructured", "Dad Hat", "Visor", "Beanie"],
  shirt: ["T-Shirt", "Long Sleeve", "Tank", "Youth Tee"],
  tumbler: ["Tumbler"],
};

function blankColor(): ColorDraft {
  return { colorName: "", colorHex: "#9a9a9a", imageUrl: "", backImageUrl: "", uploadingFront: false, uploadingBack: false };
}

function blankDraft(productType: ProductType): Draft {
  return {
    productType,
    productName: "",
    brandName: "",
    description: "",
    category: CATEGORY_SUGGESTIONS[productType][0] ?? "",
    basePrice: "",
    hasSizes: false,
    sizes: [{ name: "One Size", price: "0", inventory: "999" }],
    colors: [blankColor()],
  };
}

function productToDraft(p: Product): Draft {
  const hasSizes = Boolean(p.colors[0]?.sizes?.length);
  return {
    productType: p.productType,
    productName: p.productName,
    brandName: p.brandName,
    description: p.description,
    category: p.category,
    basePrice: String(p.basePrice),
    hasSizes,
    sizes: hasSizes
      ? p.colors[0]!.sizes!.map((s) => ({ name: s.name, price: String(s.price), inventory: String(s.inventory) }))
      : [{ name: "One Size", price: String(p.basePrice), inventory: "999" }],
    colors: p.colors.map((c) => ({
      colorName: c.colorName,
      colorHex: c.colorHexes[0] ?? "#9a9a9a",
      imageUrl: c.imageUrl,
      backImageUrl: c.backImageUrl ?? "",
      uploadingFront: false,
      uploadingBack: false,
    })),
  };
}

// Admin form for adding or editing a hand-entered ("custom") product — the
// only way Tumblers get into the catalog (they're not in the SanMar feed),
// and also usable for a one-off hat/shirt SanMar doesn't carry. Photos are
// uploaded through the same /api/admin/item-image endpoint used for photo
// overrides on SanMar items — it's already generic on styleNumber/colorName,
// so it works here unchanged, keyed by a client-generated id for a new
// product (or the real styleNumber when editing one that already exists).
export default function AdminCustomProductForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pendingId] = useState(() => editing?.styleNumber ?? `custom-${uuid().slice(0, 8)}`);
  const [draft, setDraft] = useState<Draft>(() => (editing ? productToDraft(editing) : blankDraft("tumbler")));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function updateColor(i: number, patch: Partial<ColorDraft>) {
    setDraft((d) => ({ ...d, colors: d.colors.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
  }

  function addColor() {
    setDraft((d) => ({ ...d, colors: [...d.colors, blankColor()] }));
  }

  function removeColor(i: number) {
    setDraft((d) => ({ ...d, colors: d.colors.filter((_, idx) => idx !== i) }));
  }

  function updateSize(i: number, patch: Partial<Draft["sizes"][number]>) {
    setDraft((d) => ({ ...d, sizes: d.sizes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  }

  function addSize() {
    setDraft((d) => ({ ...d, sizes: [...d.sizes, { name: "", price: d.basePrice || "0", inventory: "999" }] }));
  }

  function removeSize(i: number) {
    setDraft((d) => ({ ...d, sizes: d.sizes.filter((_, idx) => idx !== i) }));
  }

  async function handleUpload(i: number, view: "front" | "back", file: File) {
    const color = draft.colors[i];
    if (!color.colorName.trim()) {
      setError("Give this color a name before uploading a photo.");
      return;
    }
    updateColor(i, view === "front" ? { uploadingFront: true } : { uploadingBack: true });
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("styleNumber", pendingId);
      body.append("colorName", color.colorName.trim());
      body.append("view", view);
      const res = await fetch("/api/admin/item-image", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      updateColor(i, view === "front" ? { imageUrl: data.url, uploadingFront: false } : { backImageUrl: data.url, uploadingBack: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      updateColor(i, view === "front" ? { uploadingFront: false } : { uploadingBack: false });
    }
  }

  function buildProduct(): Omit<Product, "styleNumber" | "isCustom"> | null {
    if (!draft.productName.trim()) {
      setError("Give the product a name.");
      return null;
    }
    const basePrice = Number(draft.basePrice);
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      setError("Base price must be a non-negative number.");
      return null;
    }
    const validColors = draft.colors.filter((c) => c.colorName.trim() && c.imageUrl);
    if (!validColors.length) {
      setError("Add at least one color with a name and an uploaded photo.");
      return null;
    }
    let sizes: ProductSize[] | undefined;
    if (draft.hasSizes) {
      sizes = draft.sizes
        .filter((s) => s.name.trim())
        .map((s) => ({
          name: s.name.trim(),
          price: Number(s.price) || 0,
          inventory: Number(s.inventory) || 0,
        }));
      if (!sizes.length) {
        setError("Add at least one size, or turn off per-size pricing.");
        return null;
      }
    }
    const colors: ProductColor[] = validColors.map((c) => ({
      colorName: c.colorName.trim(),
      colorHexes: [c.colorHex],
      imageUrl: c.imageUrl,
      imageIsOverride: true,
      backImageUrl: c.backImageUrl || undefined,
      backImageIsOverride: c.backImageUrl ? true : undefined,
      sizes,
    }));
    const hero = colors[0]!;
    return {
      brandName: draft.brandName.trim() || "Custom",
      productName: draft.productName.trim(),
      description: draft.description.trim(),
      productType: draft.productType,
      category: draft.category as Product["category"],
      basePrice,
      colors,
      heroImageUrl: hero.imageUrl,
      heroImageIsOverride: true,
    };
  }

  async function handleSave() {
    const product = buildProduct();
    if (!product) return;
    setSaving(true);
    setError(null);
    try {
      const res = editing
        ? await fetch("/api/admin/custom-products", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ styleNumber: editing.styleNumber, ...product }),
          })
        : await fetch("/api/admin/custom-products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ styleNumber: pendingId, ...product }),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-navy/40 flex items-start justify-center overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-navy text-lg">
            {editing ? "Edit custom product" : "Add a custom product"}
          </h2>
          <button onClick={onClose} className="text-sm text-navy/50 hover:text-navy">
            Close
          </button>
        </div>
        <p className="mt-1 text-xs text-navy/50">
          Hand-entered products don&apos;t come from the SanMar catalog — use this for Tumblers
          (or any hat/shirt SanMar doesn&apos;t carry). You can hide/show and configure
          decorations for it just like any other catalog item once it&apos;s saved.
        </p>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-sm text-navy/70">
            Product type
            <select
              value={draft.productType}
              disabled={Boolean(editing)}
              onChange={(e) => {
                const productType = e.target.value as ProductType;
                apply({ productType, category: CATEGORY_SUGGESTIONS[productType][0] ?? "" });
              }}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm disabled:bg-navy/5 disabled:text-navy/40"
            >
              <option value="hat">Hat</option>
              <option value="shirt">Shirt</option>
              <option value="tumbler">Tumbler</option>
            </select>
          </label>
          <label className="text-sm text-navy/70 sm:col-span-2">
            Category
            <input
              list="category-suggestions"
              type="text"
              value={draft.category}
              onChange={(e) => apply({ category: e.target.value })}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
            <datalist id="category-suggestions">
              {CATEGORY_SUGGESTIONS[draft.productType].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm text-navy/70">
            Product name
            <input
              type="text"
              value={draft.productName}
              onChange={(e) => apply({ productName: e.target.value })}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm text-navy/70">
            Brand (optional)
            <input
              type="text"
              value={draft.brandName}
              onChange={(e) => apply({ brandName: e.target.value })}
              placeholder="Custom"
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

        <label className="mt-3 block text-sm text-navy/70 max-w-xs">
          Base price ($, cheapest size/color)
          <input
            type="number"
            min={0}
            step="0.01"
            value={draft.basePrice}
            onChange={(e) => apply({ basePrice: e.target.value })}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
          />
        </label>

        <div className="mt-4 pt-3 border-t border-navy/10">
          <label className="flex items-center gap-1.5 text-sm text-navy/70 cursor-pointer select-none">
            <input type="checkbox" checked={draft.hasSizes} onChange={(e) => apply({ hasSizes: e.target.checked })} />
            Has multiple sizes (per-size pricing, e.g. 20oz / 30oz)
          </label>
          {draft.hasSizes && (
            <div className="mt-2 space-y-2">
              {draft.sizes.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Size name"
                    value={s.name}
                    onChange={(e) => updateSize(i, { name: e.target.value })}
                    className="w-32 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Price"
                    value={s.price}
                    onChange={(e) => updateSize(i, { price: e.target.value })}
                    className="w-24 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="Inventory"
                    value={s.inventory}
                    onChange={(e) => updateSize(i, { inventory: e.target.value })}
                    className="w-24 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                  />
                  <button
                    onClick={() => removeSize(i)}
                    disabled={draft.sizes.length <= 1}
                    className="ml-auto text-xs text-red-600 hover:underline disabled:text-navy/20"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button onClick={addSize} className="text-sm px-3 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5">
                + Add size
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-navy/10">
          <div className="text-sm font-medium text-navy">Colors</div>
          <div className="mt-2 space-y-4">
            {draft.colors.map((c, i) => (
              <div key={i} className="border border-navy/10 rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Color name"
                    value={c.colorName}
                    onChange={(e) => updateColor(i, { colorName: e.target.value })}
                    className="flex-1 border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
                  />
                  <input
                    type="color"
                    value={c.colorHex}
                    onChange={(e) => updateColor(i, { colorHex: e.target.value })}
                    className="w-9 h-9 border border-navy/20 rounded-lg"
                  />
                  <button
                    onClick={() => removeColor(i)}
                    disabled={draft.colors.length <= 1}
                    className="text-xs text-red-600 hover:underline disabled:text-navy/20"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <div>
                    <label className="text-xs text-navy/60 block mb-1">Front photo</label>
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.imageUrl} alt="" className="w-16 h-16 object-contain border border-navy/10 rounded-lg bg-cream" />
                    ) : (
                      <input
                        type="file"
                        accept="image/*"
                        disabled={c.uploadingFront}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUpload(i, "front", file);
                        }}
                        className="text-xs"
                      />
                    )}
                    {c.imageUrl && (
                      <button
                        onClick={() => updateColor(i, { imageUrl: "" })}
                        className="mt-1 block text-[11px] text-red-600 hover:underline"
                      >
                        Replace
                      </button>
                    )}
                    {c.uploadingFront && <p className="text-[11px] text-navy/40">Uploading…</p>}
                  </div>
                  <div>
                    <label className="text-xs text-navy/60 block mb-1">Back photo (optional)</label>
                    {c.backImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.backImageUrl} alt="" className="w-16 h-16 object-contain border border-navy/10 rounded-lg bg-cream" />
                    ) : (
                      <input
                        type="file"
                        accept="image/*"
                        disabled={c.uploadingBack}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUpload(i, "back", file);
                        }}
                        className="text-xs"
                      />
                    )}
                    {c.backImageUrl && (
                      <button
                        onClick={() => updateColor(i, { backImageUrl: "" })}
                        className="mt-1 block text-[11px] text-red-600 hover:underline"
                      >
                        Replace
                      </button>
                    )}
                    {c.uploadingBack && <p className="text-[11px] text-navy/40">Uploading…</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={addColor} className="mt-3 text-sm px-3 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5">
            + Add color
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add product"}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-full border border-navy/20 text-sm font-medium hover:bg-navy/5">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
