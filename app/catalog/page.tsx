"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import StepHeader from "@/components/StepHeader";
import { Product, ProductType } from "@/lib/types";
import { formatUSD } from "@/lib/pricing";
import { productPreviewImageUrl } from "@/lib/product-image";

const HAT_CATEGORIES = [
  "All",
  "Trucker",
  "Structured",
  "Unstructured",
  "Dad Hat",
  "Visor",
  "Beanie",
] as const;

const SHIRT_CATEGORIES = ["All", "T-Shirt", "Long Sleeve", "Tank", "Youth Tee"] as const;

const POLO_CATEGORIES = ["All", "Polo", "Performance Polo", "Ladies Polo", "Youth Polo"] as const;

const TUMBLER_CATEGORIES = ["All", "Tumbler"] as const;

function categoriesFor(productType: ProductType): readonly string[] {
  if (productType === "hat") return HAT_CATEGORIES;
  if (productType === "shirt") return SHIRT_CATEGORIES;
  if (productType === "polo") return POLO_CATEGORIES;
  return TUMBLER_CATEGORIES;
}

function tabLabel(productType: ProductType): string {
  if (productType === "hat") return "Hats";
  if (productType === "shirt") return "T-Shirts";
  if (productType === "polo") return "Polos";
  return "Tumblers";
}

export default function CatalogPage() {
  const [productType, setProductType] = useState<ProductType>("hat");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("All");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/catalog?type=${productType}`)
      .then((r) => r.json())
      .then((data) => setProducts(data))
      .finally(() => setLoading(false));
  }, [productType]);

  const categories = categoriesFor(productType);
  const filtered =
    category === "All" ? products : products.filter((p) => p.category === category);

  return (
    <>
      <StepHeader />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-10 w-full min-h-[70vh]">
        <h1 className="text-2xl sm:text-3xl font-bold text-admin-ink font-heading uppercase tracking-tight">
          Choose your gear
        </h1>
        <p className="mt-1.5 text-admin-ink/60 text-sm">
          Preset blanks pulled from our wholesale catalog (SanMar). Pick a style, then
          customize it on the next step.
        </p>

        <div className="mt-6 flex gap-2 flex-wrap">
          {(["hat", "shirt", "polo", "tumbler"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setProductType(t);
                setCategory("All");
              }}
              className={`px-4 py-2 rounded-full text-sm font-semibold border transition ${
                productType === t
                  ? "bg-admin-accent text-admin-accent-ink border-red shadow-sm shadow-red/30"
                  : "border-admin-ink/20 text-admin-ink/70 hover:bg-admin-ink/5 hover:border-admin-ink/35"
              }`}
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3.5 py-1.5 rounded-full text-sm border transition ${
                category === c
                  ? "bg-admin-accent text-admin-accent-ink border-admin-ink font-semibold"
                  : "border-admin-ink/15 text-admin-ink/60 hover:bg-admin-ink/5 hover:border-admin-ink/30"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="mt-10 text-admin-ink/40 text-sm">Loading catalog…</p>
        ) : filtered.length === 0 ? (
          <div className="mt-10 text-center py-14 px-6 rounded-2xl border border-admin-ink/10 bg-admin-card">
            <p className="text-admin-ink/60 text-sm">
              No styles in this category yet — try another tab above.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {filtered.map((product) => (
              <Link
                key={product.styleNumber}
                href={`/customize?style=${product.styleNumber}&type=${product.productType}`}
                className="group border-2 border-admin-ink/10 rounded-2xl bg-admin-card overflow-hidden shadow-sm shadow-slate-900/10 hover:border-red hover:shadow-lg hover:shadow-slate-900/10 hover:-translate-y-0.5 transition"
              >
                <div className="relative w-full aspect-square bg-admin-ink/5 p-6">
                  <Image
                    src={
                      product.heroImageIsOverride
                        ? product.heroImageUrl
                        : productPreviewImageUrl(product.heroImageUrl, product.heroImageFallbackUrl)
                    }
                    alt={product.productName}
                    fill
                    unoptimized
                    className="object-contain"
                    sizes="(max-width: 640px) 100vw, 25vw"
                  />
                </div>
                <div className="p-4">
                  <div className="text-xs uppercase tracking-wide text-admin-ink/40">
                    {product.brandName} · {product.styleNumber}
                  </div>
                  <div className="font-semibold text-admin-ink mt-0.5">
                    {product.productName}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm text-admin-ink/60">
                      {product.colors.length} colors
                    </span>
                    <span className="font-semibold text-admin-ink">
                      {formatUSD(product.basePrice)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
