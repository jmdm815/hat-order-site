"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { DecorationOption, Product, ProductType } from "@/lib/types";
import { formatUSD } from "@/lib/pricing";
import { productPreviewImageUrl } from "@/lib/product-image";
import { computeEstimate } from "@/lib/quote-estimate";

const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  hat: "Hats",
  shirt: "T-Shirts",
  polo: "Polos",
  tumbler: "Tumblers",
};

type Step = 1 | 2 | 3 | 4;

// Decoration-first quote builder: pick a decoration method up front, then a
// garment compatible with it (drawn straight from the live SanMar catalog —
// same admin show/hide curation as the rest of the site, via /api/catalog —
// so "most, if not all" of the catalog is available here, not just items an
// admin has hand-picked for the homepage), then color/size/quantity, then
// print locations or a stitch-count band, and get a live price at every
// step using the same real, account-specific SanMar pricing the rest of the
// site uses. No artwork upload — this is pricing only.
export default function QuoteBuilderWizard() {
  const [step, setStep] = useState<Step>(1);

  // Step 1: decoration
  const [decorations, setDecorations] = useState<DecorationOption[] | null>(null);
  const [decorationId, setDecorationId] = useState<string>("");
  const decoration = decorations?.find((d) => d.id === decorationId);

  // Step 2: garment
  const [garments, setGarments] = useState<Product[] | null>(null);
  const [garmentsLoading, setGarmentsLoading] = useState(false);
  const [productTypeFilter, setProductTypeFilter] = useState<ProductType | "all">("all");
  const [search, setSearch] = useState("");
  const [, setStyleNumber] = useState<string>("");

  // Step 3: product detail (live-priced) + color/size/qty
  const [product, setProduct] = useState<Product | null>(null);
  const [productLoading, setProductLoading] = useState(false);
  const [colorName, setColorName] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(24);
  const [sizeQuantities, setSizeQuantities] = useState<Record<string, number>>({});

  // Step 4: locations / stitch count + repeat-logo
  const [columnId, setColumnId] = useState<string>("");
  const [unknownStitchCount, setUnknownStitchCount] = useState(false);
  const [sameLogoBefore, setSameLogoBefore] = useState(false);

  useEffect(() => {
    fetch("/api/decorations")
      .then((r) => r.json())
      .then((data: DecorationOption[]) => setDecorations(data));
  }, []);

  function chooseDecoration(id: string) {
    setDecorationId(id);
    setGarments(null);
    setStyleNumber("");
    setProduct(null);
    setStep(2);
  }

  useEffect(() => {
    if (step !== 2 || !decoration) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGarmentsLoading(true);
    Promise.all(
      decoration.productTypes.map((t) =>
        fetch(`/api/catalog?type=${t}`).then((r) => r.json() as Promise<Product[]>)
      )
    )
      .then((lists) => setGarments(lists.flat()))
      .finally(() => setGarmentsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, decorationId]);

  const filteredGarments = useMemo(() => {
    if (!garments) return [];
    const q = search.trim().toLowerCase();
    return garments.filter((g) => {
      if (productTypeFilter !== "all" && g.productType !== productTypeFilter) return false;
      if (!q) return true;
      return (
        g.productName.toLowerCase().includes(q) ||
        g.brandName.toLowerCase().includes(q) ||
        g.styleNumber.toLowerCase().includes(q)
      );
    });
  }, [garments, productTypeFilter, search]);

  const availableProductTypes = useMemo(() => {
    if (!garments) return [];
    return Array.from(new Set(garments.map((g) => g.productType)));
  }, [garments]);

  function chooseGarment(style: string) {
    setStyleNumber(style);
    setProduct(null);
    setProductLoading(true);
    setColumnId(decoration?.priceColumns?.[0]?.id ?? "");
    setUnknownStitchCount(false);
    fetch(`/api/products/${encodeURIComponent(style)}`)
      .then((r) => r.json())
      .then((data: { product: Product }) => {
        setProduct(data.product);
        setColorName(data.product.colors[0]?.colorName ?? "");
        setSizeQuantities({});
      })
      .finally(() => setProductLoading(false));
    setStep(3);
  }

  const color = product?.colors.find((c) => c.colorName === colorName) ?? product?.colors[0];
  const hasSizes = Boolean(color?.sizes?.length);
  const totalQuantity = hasSizes
    ? Object.values(sizeQuantities).reduce((sum, q) => sum + (q || 0), 0)
    : quantity;
  const garmentTotal = useMemo(() => {
    if (!color) return 0;
    if (hasSizes) {
      return (color.sizes ?? []).reduce((sum, s) => sum + (sizeQuantities[s.name] || 0) * s.price, 0);
    }
    return quantity * (product?.basePrice ?? 0);
  }, [color, hasSizes, sizeQuantities, quantity, product]);

  const effectiveColumnId = unknownStitchCount ? undefined : columnId || undefined;
  const estimate = computeEstimate({
    garmentTotal,
    quantity: totalQuantity,
    decoration: unknownStitchCount ? undefined : decoration,
    columnId: effectiveColumnId,
    sameLogoBefore,
  });
  // "I don't know my stitch count" forces quote-required messaging (same
  // semantics as DecorationOption.allowUnknownStitchCount elsewhere), so
  // fold that in rather than pretending there's no decoration at all.
  const showQuoteRequired = decoration?.quoteRequired || (unknownStitchCount && totalQuantity > 0);
  const garmentOnlyEstimate = { ...estimate, total: garmentTotal };

  const steps: { id: Step; label: string }[] = [
    { id: 1, label: "Decoration" },
    { id: 2, label: "Garment" },
    { id: 3, label: "Color & quantity" },
    { id: 4, label: "Placement & pricing" },
  ];

  return (
    <div>
      <ol className="flex flex-wrap items-center gap-2 text-sm mb-8">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <button
              onClick={() => setStep(s.id)}
              disabled={s.id > step}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition ${
                s.id === step
                  ? "bg-navy text-white border-navy"
                  : s.id < step
                    ? "border-navy/30 text-navy hover:bg-navy/5"
                    : "border-navy/10 text-navy/30"
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-semibold">
                {s.id}
              </span>
              {s.label}
            </button>
            {i < steps.length - 1 && <span className="w-4 h-px bg-navy/15" />}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div>
          <h2 className="font-heading text-xl font-semibold uppercase text-navy tracking-wide">
            Pick a decoration method
          </h2>
          {!decorations ? (
            <p className="mt-6 text-navy/40 text-sm">Loading…</p>
          ) : (
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {decorations.map((d) => (
                <button
                  key={d.id}
                  onClick={() => chooseDecoration(d.id)}
                  className="text-left border-2 border-navy/10 rounded-2xl p-5 bg-white hover:border-red hover:shadow-md transition"
                >
                  <div className="font-heading font-semibold uppercase text-navy tracking-wide">
                    {d.shortLabel}
                  </div>
                  <p className="mt-1.5 text-sm text-navy/60">{d.description}</p>
                  <p className="mt-2 text-xs text-navy/40">{d.turnaroundDays}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 2 && decoration && (
        <div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="font-heading text-xl font-semibold uppercase text-navy tracking-wide">
              Pick a garment for {decoration.shortLabel}
            </h2>
            <button onClick={() => setStep(1)} className="text-sm text-navy/60 hover:text-navy">
              ← Change decoration
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 items-center">
            <input
              type="text"
              placeholder="Search brand, name, or style #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-navy/20 rounded-lg px-3 py-2 text-sm w-64"
            />
            {availableProductTypes.length > 1 && (
              <div className="flex gap-1">
                <button
                  onClick={() => setProductTypeFilter("all")}
                  className={`px-3 py-2 text-sm rounded-lg border ${
                    productTypeFilter === "all"
                      ? "bg-navy text-white border-navy"
                      : "border-navy/20 text-navy/70 hover:bg-navy/5"
                  }`}
                >
                  All
                </button>
                {availableProductTypes.map((t) => (
                  <button
                    key={t}
                    onClick={() => setProductTypeFilter(t)}
                    className={`px-3 py-2 text-sm rounded-lg border ${
                      productTypeFilter === t
                        ? "bg-navy text-white border-navy"
                        : "border-navy/20 text-navy/70 hover:bg-navy/5"
                    }`}
                  >
                    {PRODUCT_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
            <span className="text-sm text-navy/50 ml-auto">
              {garmentsLoading ? "Loading…" : `${filteredGarments.length} styles`}
            </span>
          </div>

          {garmentsLoading ? (
            <p className="mt-10 text-navy/40 text-sm">Loading catalog…</p>
          ) : (
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {filteredGarments.map((g) => (
                <button
                  key={g.styleNumber}
                  onClick={() => chooseGarment(g.styleNumber)}
                  className="text-left border-2 border-navy/10 rounded-2xl bg-white overflow-hidden hover:border-red hover:shadow-md transition"
                >
                  <div className="relative w-full aspect-square bg-gray p-4">
                    <Image
                      src={
                        g.heroImageIsOverride
                          ? g.heroImageUrl
                          : productPreviewImageUrl(g.heroImageUrl, g.heroImageFallbackUrl)
                      }
                      alt={g.productName}
                      fill
                      unoptimized
                      className="object-contain"
                      sizes="200px"
                    />
                  </div>
                  <div className="p-2.5">
                    <div className="text-[11px] uppercase tracking-wide text-navy/40 truncate">
                      {g.brandName} · {g.styleNumber}
                    </div>
                    <div className="text-xs font-semibold text-navy leading-tight line-clamp-2 mt-0.5">
                      {g.productName}
                    </div>
                    <div className="text-xs text-navy/60 mt-1">{formatUSD(g.basePrice)}+</div>
                  </div>
                </button>
              ))}
              {filteredGarments.length === 0 && (
                <p className="col-span-full text-navy/40 text-sm py-10 text-center">
                  No garments match — try a different search or filter.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {step >= 3 && decoration && (
        <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-8">
          <div>
            {productLoading || !product ? (
              <div className="w-full aspect-square bg-gray rounded-2xl animate-pulse" />
            ) : (
              <>
                <div className="relative w-full aspect-square bg-gray rounded-2xl p-6">
                  <Image
                    src={
                      product.heroImageIsOverride
                        ? product.heroImageUrl
                        : productPreviewImageUrl(
                            color?.imageUrl ?? product.heroImageUrl,
                            color?.imageFallbackUrl ?? product.heroImageFallbackUrl
                          )
                    }
                    alt={product.productName}
                    fill
                    unoptimized
                    className="object-contain"
                    sizes="320px"
                  />
                </div>
                <div className="mt-3 text-xs uppercase tracking-wide text-navy/40">
                  {product.brandName} · {product.styleNumber}
                </div>
                <div className="font-semibold text-navy">{product.productName}</div>
                <button
                  onClick={() => setStep(2)}
                  className="mt-2 text-sm text-navy/60 hover:text-navy"
                >
                  ← Change garment
                </button>
              </>
            )}
          </div>

          <div>
            {productLoading || !product ? (
              <p className="text-navy/40 text-sm">Loading pricing…</p>
            ) : (
              <>
                <div className="space-y-5">
                  <div>
                    <label className="text-sm font-medium text-navy">Color</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {product.colors.map((c) => (
                        <button
                          key={c.colorName}
                          onClick={() => setColorName(c.colorName)}
                          className={`px-3 py-1.5 rounded-full text-sm border transition ${
                            colorName === c.colorName
                              ? "bg-navy text-white border-navy"
                              : "border-navy/20 text-navy/70 hover:bg-navy/5"
                          }`}
                        >
                          {c.colorName}
                        </button>
                      ))}
                    </div>
                  </div>

                  {hasSizes ? (
                    <div>
                      <label className="text-sm font-medium text-navy">Quantity by size</label>
                      <div className="mt-2 grid grid-cols-4 sm:grid-cols-6 gap-2">
                        {(color?.sizes ?? []).map((s) => (
                          <label key={s.name} className="text-xs text-navy/70">
                            {s.name}
                            <input
                              type="number"
                              min={0}
                              value={sizeQuantities[s.name] ?? ""}
                              onChange={(e) =>
                                setSizeQuantities((prev) => ({
                                  ...prev,
                                  [s.name]: Math.max(0, Number(e.target.value) || 0),
                                }))
                              }
                              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
                              placeholder="0"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-sm font-medium text-navy">Quantity</label>
                      <input
                        type="number"
                        min={1}
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                        className="mt-2 w-32 border border-navy/20 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  )}

                  {decoration.priceColumns && decoration.priceColumns.length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-navy">
                        {decoration.priceColumns[0].label.toLowerCase().includes("stitch")
                          ? "Stitch count"
                          : "Print locations"}
                      </label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {decoration.priceColumns.map((col) => (
                          <button
                            key={col.id}
                            onClick={() => {
                              setColumnId(col.id);
                              setUnknownStitchCount(false);
                            }}
                            className={`px-3 py-1.5 rounded-full text-sm border transition ${
                              columnId === col.id && !unknownStitchCount
                                ? "bg-navy text-white border-navy"
                                : "border-navy/20 text-navy/70 hover:bg-navy/5"
                            }`}
                          >
                            {col.label}
                          </button>
                        ))}
                      </div>
                      {decoration.allowUnknownStitchCount && (
                        <label className="mt-2 flex items-center gap-2 text-sm text-navy/70">
                          <input
                            type="checkbox"
                            checked={unknownStitchCount}
                            onChange={(e) => setUnknownStitchCount(e.target.checked)}
                          />
                          I don&apos;t know my stitch count
                        </label>
                      )}
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-sm text-navy/70">
                    <input
                      type="checkbox"
                      checked={sameLogoBefore}
                      onChange={(e) => setSameLogoBefore(e.target.checked)}
                    />
                    I&apos;ve ordered with this same logo before (waives setup fee)
                  </label>
                </div>

                <div className="mt-8 border border-navy/10 rounded-2xl p-5 bg-white max-w-sm">
                  <h3 className="font-heading font-semibold uppercase text-navy tracking-wide text-sm">
                    Live price
                  </h3>
                  {totalQuantity <= 0 ? (
                    <p className="mt-2 text-sm text-navy/50">Enter a quantity to see pricing.</p>
                  ) : showQuoteRequired ? (
                    <p className="mt-2 text-sm text-navy/70">
                      {decoration.shortLabel}&apos;s pricing depends on your design — we&apos;ll
                      follow up with an exact quote once we see it. Garment cost for{" "}
                      {totalQuantity} units:{" "}
                      <span className="font-semibold">{formatUSD(garmentOnlyEstimate.garmentTotal)}</span>.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-1.5 text-sm">
                      <div className="flex justify-between text-navy/70 gap-4">
                        <span>
                          Garment + {decoration.shortLabel} (
                          {formatUSD(
                            (estimate.garmentTotal + estimate.decorationTotal) / totalQuantity
                          )}
                          /unit)
                        </span>
                        <span className="shrink-0">
                          {formatUSD(estimate.garmentTotal + estimate.decorationTotal)}
                        </span>
                      </div>
                      {estimate.setupFee > 0 && (
                        <div className="flex justify-between text-navy/70">
                          <span>Setup fee</span>
                          <span>{formatUSD(estimate.setupFee)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold text-navy pt-2 border-t border-navy/10 mt-2">
                        <span>Total</span>
                        <span>{formatUSD(estimate.total)}</span>
                      </div>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-navy/40">
                    Live SanMar pricing for this style/color. Setup fees may be waived at higher
                    quantities or repeat orders.
                  </p>
                  <Link
                    href={`/customize?style=${encodeURIComponent(product.styleNumber)}&type=${product.productType}`}
                    className="mt-4 block text-center px-4 py-2.5 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition"
                  >
                    Ready to order? Design Now →
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
