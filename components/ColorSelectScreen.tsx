"use client";

import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Product, ProductColor } from "@/lib/types";

// Shown before the live designer opens for a product — lets the customer
// pick a garment color up front (with a full name + swatch list, like a
// wholesale catalog color picker) instead of landing straight in the
// designer on whatever color happens to be first. They can still change it
// again once inside the designer via its own color panel; this screen is
// just about starting from an intentional choice rather than a default.
function swatchBackground(hexes: string[]): CSSProperties {
  if (hexes.length <= 1) {
    return { backgroundColor: hexes[0] ?? "#9a9a9a" };
  }
  if (hexes.length === 2) {
    return { backgroundImage: `linear-gradient(135deg, ${hexes[0]} 50%, ${hexes[1]} 50%)` };
  }
  const step = 360 / hexes.length;
  const stops = hexes
    .map((hex, i) => `${hex} ${i * step}deg ${(i + 1) * step}deg`)
    .join(", ");
  return { backgroundImage: `conic-gradient(${stops})` };
}

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
        className="text-sm text-navy/60 hover:text-navy"
      >
        ← Back to catalog
      </button>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-8">
        {/* Preview */}
        <div>
          <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-white border border-navy/10 p-8">
            {selectedColor && renderPreview(selectedColor)}
          </div>
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wide text-navy/40">
              {product.brandName} · {product.styleNumber}
            </div>
            <div className="font-semibold text-lg text-navy">{product.productName}</div>
            <p className="mt-1 text-sm text-navy/60">{product.description}</p>
          </div>
        </div>

        {/* Color picker */}
        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold text-navy text-lg">Choose a color</h2>
            <span className="text-sm text-navy/60">{product.colors.length} colors</span>
          </div>
          <p className="mt-1 text-sm text-navy/60">
            Pick the garment color you want to design on. You can change it again once
            you&apos;re inside the designer.
          </p>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[26rem] overflow-y-auto pr-1">
            {product.colors.map((c) => (
              <button
                key={c.colorName}
                type="button"
                onClick={() => onSelectColor(c.colorName)}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition ${
                  colorName === c.colorName
                    ? "border-red ring-1 ring-red bg-white"
                    : "border-navy/10 bg-white hover:border-navy/30"
                }`}
              >
                <span
                  className="w-7 h-7 rounded-full border border-black/10 shrink-0"
                  style={swatchBackground(c.colorHexes)}
                />
                <span className="text-sm text-navy truncate">{c.colorName}</span>
              </button>
            ))}
          </div>

          <button
            onClick={onContinue}
            className="mt-6 w-full sm:w-auto px-8 py-3 rounded-md bg-red text-white font-heading font-semibold hover:bg-red-dark transition"
          >
            Design Now →
          </button>
        </div>
      </div>
    </div>
  );
}
