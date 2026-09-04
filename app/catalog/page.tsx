"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import StepHeader from "@/components/StepHeader";
import { Product, ProductType } from "@/lib/types";
import { formatUSD } from "@/lib/pricing";
import { productImageUrl } from "@/lib/product-image";

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

const TUMBLER_CATEGORIES = ["All", "Tumbler"] as const;

function categoriesFor(productType: ProductType): readonly string[] {
  if (productType === "hat") return HAT_CATEGORIES;
  if (productType === "shirt") return SHIRT_CATEGORIES;
  return TUMBLER_CATEGORIES;
}

function tabLabel(productType: ProductType): string {
  if (productType === "hat") return "Hats";
  if (productType === "shirt") return "T-Shirts";
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
      <main className="flex-1 max-w-6xl mx-auto px-4 py-10 w-full bg-white">
        <h1 className="text-2xl font-bold text-navy">Choose your gear</h1>
        <p className="mt-1 text-navy/60 text-sm">
          Preset blanks pulled from our wholesale catalog (SanMar). Pick a style, then
          customize it on the next step.
        </p>

        <div className="mt-5 flex gap-2">
          {(["hat", "shirt", "tumbler"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setProductType(t);
                setCategory("All");
              }}
              className={`px-4 py-2 rounded-full text-sm font-semibold border transition ${
                productType === t
                  ? "bg-navy text-white border-navy"
                  : "border-navy/20 text-navy/70 hover:bg-gray"
              }`}
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3.5 py-1.5 rounded-full text-sm border transition ${
                category === c
                  ? "bg-navy text-white border-navy"
                  : "border-navy/20 text-navy/70 hover:bg-gray"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="mt-10 text-navy/40 text-sm">Loading catalog…</p>
        ) : (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {filtered.map((product) => (
              <Link
                key={product.styleNumber}
                href={`/customize?style=${product.styleNumber}&type=${product.productType}`}
                className="group border-2 border-navy/10 rounded-2xl bg-white overflow-hidden hover:border-red hover:shadow-md hover:-translate-y-0.5 transition"
              >
                <div className="relative w-full aspect-square bg-gray p-6">
                  <Image
                    src={
                      product.heroImageIsOverride
                        ? product.heroImageUrl
                        : productImageUrl(product.heroImageUrl, product.heroImageFallbackUrl)
                    }
                    alt={product.productName}
                    fill
                    unoptimized
                    className="object-contain"
                    sizes="(max-width: 640px) 100vw, 25vw"
                  />
                </div>
                <div className="p-4">
                  <div className="text-xs uppercase tracking-wide text-navy/40">
                    {product.brandName} · {product.styleNumber}
                  </div>
                  <div className="font-semibold text-navy mt-0.5">
                    {product.productName}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm text-navy/60">
                      {product.colors.length} colors
                    </span>
                    <span className="font-semibold text-black">
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
