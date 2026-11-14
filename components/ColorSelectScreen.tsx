"use client";

import type { ReactNode } from "react";
import { swatchStyle } from "@/lib/swatch";
import { useRouter } from "next/navigation";
import { Product, ProductColor } from "@/lib/types";

// Shown before the live designer opens for a product — lets the customer
// pick a garment color up front (with a full name + swatch list, like a
// wholesale catalog color picker) instead of landing straight in the
// designer on whatever color happens to be first. They can still change it
// again once inside the designer via its own color panel; this screen is
// just about starting from an intentional choice rather than a default.
export default function ColorSelectScreen({
  product,
  colorName,
  onSelectColor,
  onContinue,
  renderPreview,
}: {
  product: Product;
  colorName: string;
  onSelectColor: (colorName: string) => void;
  onContinue: () => void;
  // Renders the preview image for a given color — callers supply this
  // because hats always have a real photo while shirts fall back to an
  // illustrated silhouette (via GarmentPreview) when SanMar has none.
  renderPreview: (color: ProductColor) => ReactNode;
}) {
  const router = useRouter();
  const selectedColor = product.colors.find((c) => c.colorName === colorName) ?? product.colors[0];

  return (
    <div className="mt-6">
      <button
        onClick={() => router.push("/catalog")}
        className="text-sm text-admin-ink/60 hover:text-admin-ink"
      >
        ← Back to catalog
      </button>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-8">
        {/* Preview */}
        <div>
          <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-admin-card border border-admin-ink/10 shadow-lg shadow-slate-900/10 p-8">
            {selectedColor && renderPreview(selectedColor)}
          </div>
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wide text-admin-ink/40">
              {product.brandName} · {product.styleNumber}
            </div>
            <div className="font-semibold text-lg text-admin-ink">{product.productName}</div>
            <p className="mt-1 text-sm text-admin-ink/60">{product.description}</p>
          </div>
        </div>

        {/* Color picker */}
        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold text-admin-ink text-lg">Choose a color</h2>
            <span className="text-sm text-admin-ink/60">{product.colors.length} colors</span>
          </div>
          <p className="mt-1 text-sm text-admin-ink/60">
            Pick the garment color you want to design on. You can change it again once
            you&apos;re inside the designer.
          </p>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[26rem] overflow-y-auto pr-1">
            {product.colors.map((c) => (
              <button
                key={c.colorName}
                type="button"
                onClick={() => onSelectColor(c.colorName)}
                className={`flex items-center gap-2.5 p-2.5 rounded-2xl border text-left transition ${
                  colorName === c.colorName
                    ? "border-red ring-1 ring-red bg-admin-card"
                    : "border-admin-ink/10 bg-admin-card hover:border-admin-ink/30"
                }`}
              >
                <span
                  className="w-7 h-7 rounded-full border border-black/10 shrink-0"
                  style={swatchStyle(c)}
                />
                <span className="text-sm text-admin-ink truncate">{c.colorName}</span>
              </button>
            ))}
          </div>

          <button
            onClick={onContinue}
            className="mt-6 w-full sm:w-auto px-8 py-3 rounded-2xl bg-admin-accent text-admin-accent-ink font-heading font-semibold hover:bg-admin-accent-dim transition"
          >
            Design Now →
          </button>
        </div>
      </div>
    </div>
  );
}
