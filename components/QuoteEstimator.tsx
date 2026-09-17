"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { DecorationOption, PlacementZone, Product } from "@/lib/types";
import { formatUSD } from "@/lib/pricing";
import { productPreviewImageUrl } from "@/lib/product-image";
import { computeEstimate } from "@/lib/quote-estimate";

type ApiResponse = {
  product: Product;
  decorations: (DecorationOption & { zones: PlacementZone[] })[];
  error?: string;
};

// Lighter-weight sibling to the full /customize designer: no artwork upload
// or placement, just color + decoration type + quantity, so a shopper can
// see a real price instantly. "Add to cart" isn't offered here — for now
// this is purely an estimate; going on to actually order still goes through
// the full Design Now flow, linked at the bottom.
export default function QuoteEstimator() {
  const params = useSearchParams();
  const styleNumber = params.get("style") ?? "";

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [colorName, setColorName] = useState<string>("");
  const [decorationId, setDecorationId] = useState<string>("");
  const [columnId, setColumnId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(24);
  const [sizeQuantities, setSizeQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!styleNumber) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/products/${encodeURIComponent(styleNumber)}`)
      .then((r) => r.json())
      .then((res: ApiResponse) => {
        setData(res);
        if (res.product) {
          setColorName(res.product.colors[0]?.colorName ?? "");
        }
        if (res.decorations?.length) {
          setDecorationId(res.decorations[0].id);
          setColumnId(res.decorations[0].priceColumns?.[0]?.id ?? "");
        }
      })
      .finally(() => setLoading(false));
  }, [styleNumber]);

  const product = data?.product;
  const color = product?.colors.find((c) => c.colorName === colorName) ?? product?.colors[0];
  const hasSizes = Boolean(color?.sizes?.length);
  const decoration = data?.decorations.find((d) => d.id === decorationId);

  const totalQuantity = hasSizes
    ? Object.values(sizeQuantities).reduce((sum, q) => sum + (q || 0), 0)
    : quantity;

  const garmentTotal = useMemo(() => {
    if (!color) return 0;
    if (hasSizes) {
      return (color.sizes ?? []).reduce(
        (sum, s) => sum + (sizeQuantities[s.name] || 0) * s.price,
        0
      );
    }
    return quantity * (product?.basePrice ?? 0);
  }, [color, hasSizes, sizeQuantities, quantity, product]);

  const estimate = computeEstimate({
    garmentTotal,
    quantity: totalQuantity,
    decoration,
    columnId: columnId || undefined,
  });

  if (!styleNumber) {
    return <p className="text-navy/60">Missing product — go back to the catalog and pick an item.</p>;
  }
  if (loading) {
    return <p className="text-navy/40 text-sm">Loading…</p>;
  }
  if (!product) {
    return <p className="text-navy/60">Product not found.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-8">
      <div>
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
      </div>

      <div>
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

          {data && data.decorations.length > 0 && (
            <div>
              <label className="text-sm font-medium text-navy">Decoration</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.decorations.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setDecorationId(d.id);
                      setColumnId(d.priceColumns?.[0]?.id ?? "");
                    }}
                    className={`px-3 py-1.5 rounded-full text-sm border transition ${
                      decorationId === d.id
                        ? "bg-navy text-white border-navy"
                        : "border-navy/20 text-navy/70 hover:bg-navy/5"
                    }`}
                  >
                    {d.shortLabel}
                  </button>
                ))}
              </div>
              {decoration?.priceColumns && decoration.priceColumns.length > 0 && (
                <div className="mt-2">
                  <select
                    value={columnId}
                    onChange={(e) => setColumnId(e.target.value)}
                    className="border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
                  >
                    {decoration.priceColumns.map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

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
        </div>

        <div className="mt-8 border border-navy/10 rounded-2xl p-5 bg-white max-w-sm">
          <h3 className="font-heading font-semibold uppercase text-navy tracking-wide text-sm">
            Estimated price
          </h3>
          {totalQuantity <= 0 ? (
            <p className="mt-2 text-sm text-navy/50">Enter a quantity to see pricing.</p>
          ) : estimate.quoteRequired ? (
            <p className="mt-2 text-sm text-navy/70">
              This decoration&apos;s pricing depends on your design — we&apos;ll follow up with an
              exact quote once we see it. Garment cost for {totalQuantity} units:{" "}
              <span className="font-semibold">{formatUSD(estimate.garmentTotal)}</span>.
            </p>
          ) : (
            <div className="mt-3 space-y-1.5 text-sm">
              {hasSizes ? (
                (color?.sizes ?? [])
                  .filter((size) => (sizeQuantities[size.name] || 0) > 0)
                  .map((size) => {
                    const sizeQuantity = sizeQuantities[size.name] || 0;
                    const decoratedUnitPrice = size.price + estimate.decorationUnitPrice;
                    return (
                      <div
                        key={size.name}
                        className="flex justify-between text-navy/70 gap-4"
                      >
                        <span>
                          {size.name} ({sizeQuantity} × {formatUSD(decoratedUnitPrice)}/unit)
                        </span>
                        <span className="shrink-0">
                          {formatUSD(sizeQuantity * decoratedUnitPrice)}
                        </span>
                      </div>
                    );
                  })
              ) : (
                <div className="flex justify-between text-navy/70 gap-4">
                  <span>
                    {decoration ? `Garment + ${decoration.shortLabel}` : "Garment"} (
                    {formatUSD(
                      (estimate.garmentTotal + estimate.decorationTotal) / totalQuantity
                    )}
                    /unit)
                  </span>
                  <span className="shrink-0">
                    {formatUSD(estimate.garmentTotal + estimate.decorationTotal)}
                  </span>
                </div>
              )}
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
            Estimate only — setup fees may be waived at higher quantities or repeat orders.
          </p>
          <Link
            href={`/customize?style=${encodeURIComponent(product.styleNumber)}&type=${product.productType}`}
            className="mt-4 block text-center px-4 py-2.5 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition"
          >
            Ready to order? Design Now →
          </Link>
        </div>
      </div>
    </div>
  );
}
