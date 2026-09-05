"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArtworkPlacement, DecorationOption, DecorationType, PlacementZone, Product } from "@/lib/types";
import { getSetupFee, getUnitPriceForQuantity } from "@/lib/decorations";
import { formatUSD } from "@/lib/pricing";
import { useOrder } from "@/lib/order-context";
import { productImageUrl } from "@/lib/product-image";
import ShirtCustomizeForm from "./ShirtCustomizeForm";
import ColorSelectScreen from "./ColorSelectScreen";
import DragResizeBox, { type Box } from "./DragResizeBox";

type DecorationWithZones = DecorationOption & { zones: PlacementZone[] };
type ProductApiResponse = {
  product: Product;
  decorations: DecorationWithZones[];
  liveDesignerEnabled?: boolean;
};

// Fit a new artwork box within the zone's bounds (like object-contain)
// rather than always filling the zone's full width, mirroring
// ShirtCustomizeForm's fitZoneBox — kept as its own small copy here rather
// than a shared helper so this file doesn't need a new lib module just for
// ~10 lines of geometry.
function fitZoneBox(zone: PlacementZone, aspect: number): Box {
  let width = zone.width;
  let height = width * aspect;
  if (height > zone.height) {
    height = zone.height;
    width = height / aspect;
  }
  return {
    x: zone.x + (zone.width - width) / 2,
    y: zone.y + (zone.height - height) / 2,
    width,
    height,
  };
}

// Multi-tone garments (e.g. "Aruba Blue/ Birch") get a swatch split into one
// segment per color instead of a single solid dot, so the swatch actually
// resembles the garment. Two tones split diagonally (how SanMar shows them);
// three or more split into equal pie wedges.
function swatchBackground(hexes: string[]): CSSProperties {
  if (hexes.length <= 1) {
    return { backgroundColor: hexes[0] ?? "#9a9a9a" };
  }
  if (hexes.length === 2) {
    return {
      backgroundImage: `linear-gradient(135deg, ${hexes[0]} 50%, ${hexes[1]} 50%)`,
    };
  }
  const step = 360 / hexes.length;
  const stops = hexes
    .map((hex, i) => `${hex} ${i * step}deg ${(i + 1) * step}deg`)
    .join(", ");
  return { backgroundImage: `conic-gradient(${stops})` };
}

export default function CustomizeForm() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const styleNumber = searchParams.get("style");
  const { addCartLine, sameLogoBefore, setSameLogoBefore } = useOrder();

  const [data, setData] = useState<ProductApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [colorName, setColorName] = useState<string>("");
  const [decorationId, setDecorationId] = useState<DecorationType | "">("");
  const [priceColumnId, setPriceColumnId] = useState<string>("");
  const [unknownStitchCount, setUnknownStitchCount] = useState<boolean>(false);
  const [placement, setPlacement] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(24);
  const [artworkFileName, setArtworkFileName] = useState<string>("");
  const [notes, setNotes] = useState("");
  // Live-designer state (hats only, when liveDesignerEnabled — see below).
  // Declared unconditionally alongside the other hooks (not after the
  // shirt-branch early return) so hook order stays stable if the same
  // component instance re-renders for a different product type.
  const [artworkLayer, setArtworkLayer] = useState<(Box & { rotation: number }) | null>(null);
  const [artworkAspect, setArtworkAspect] = useState<number | null>(null);
  const [layerPreviewUrl, setLayerPreviewUrl] = useState<string | undefined>();
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!styleNumber) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      setNotFound(true);
      return;
    }
    fetch(`/api/products/${styleNumber}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((json: ProductApiResponse) => setData(json))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [styleNumber]);

  const product = data?.product;
  const decorations = useMemo(() => data?.decorations ?? [], [data]);

  // Default the decoration method once the fetched data arrives.
  useEffect(() => {
    if (decorations.length && !decorationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDecorationId(decorations[0].id);
    }
  }, [decorations, decorationId]);

  // Default the color picker once the fetched product data arrives.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (product && !colorName) setColorName(product.colors[0]?.colorName ?? "");
  }, [product, colorName]);

  const decoration = decorations.find((d) => d.id === decorationId);

  // Reset the placement choice (and price-column pick, e.g. stitch count)
  // whenever the decoration method changes.
  useEffect(() => {
    if (!decoration) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlacement(decoration.zones[0]?.label ?? "");
    setPriceColumnId(decoration.priceColumns?.[0]?.id ?? "");
    setUnknownStitchCount(false);
  }, [decorationId, decoration]);

  const selectedZone = decoration?.zones.find((z) => z.label === placement);

  // Re-fit the artwork box into the newly-chosen zone whenever the
  // placement changes, so an uploaded image doesn't stay positioned inside
  // a zone the customer already moved away from.
  useEffect(() => {
    if (artworkAspect != null && selectedZone) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setArtworkLayer({ ...fitZoneBox(selectedZone, artworkAspect), rotation: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement]);

  if (loading) {
    return <p className="mt-10 text-navy/40 text-sm">Loading…</p>;
  }

  if (notFound || !product) {
    return (
      <div className="mt-10">
        <p className="text-navy/70">
          We couldn&apos;t find that item. Head back and pick one from the catalog.
        </p>
        <button
          onClick={() => router.push("/catalog")}
          className="mt-4 px-5 py-2.5 rounded-md border-2 border-navy text-navy font-heading font-semibold hover:bg-navy hover:text-white transition"
        >
          ← Back to catalog
        </button>
      </div>
    );
  }

  // Polos are sized, multi-color garments with a front + back photo just
  // like shirts, so they share ShirtCustomizeForm (which is fully generic
  // on productType) rather than this component's single-decoration,
  // one-size hat/tumbler flow.
  if (product.productType === "shirt" || product.productType === "polo") {
    return (
      <ShirtCustomizeForm
        product={product}
        decorations={decorations}
        liveDesignerEnabled={data?.liveDesignerEnabled ?? true}
      />
    );
  }

  if (!decoration) {
    return <p className="mt-10 text-navy/40 text-sm">Loading…</p>;
  }

  // Gated by a "stage" URL param (rather than plain component state) so the
  // browser's Back button steps from the designer to this screen instead of
  // jumping straight past it to the catalog — pressing "Design Now" pushes
  // a new history entry, and Back simply pops it off.
  const pickingColor = searchParams.get("stage") !== "design";

  function goToDesignStage() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("stage", "design");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (pickingColor) {
    return (
      <ColorSelectScreen
        product={product}
        colorName={colorName}
        onSelectColor={setColorName}
        onContinue={goToDesignStage}
        renderPreview={(color) => (
          <Image
            src={
              color.imageIsOverride
                ? color.imageUrl
                : productImageUrl(color.imageUrl, color.imageFallbackUrl)
            }
            alt={product.productName}
            fill
            unoptimized
            className="object-contain pointer-events-none"
            sizes="420px"
          />
        )}
      />
    );
  }

  const belowMinimum = quantity < decoration.minQuantity;
  const isUnknownStitchCount = decoration.allowUnknownStitchCount === true && unknownStitchCount;
  const isQuoteOnly = decoration.quoteRequired === true || isUnknownStitchCount;
  const unitDecorationPrice = isQuoteOnly
    ? 0
    : getUnitPriceForQuantity(decoration, quantity, priceColumnId || undefined);
  const setupFee = isQuoteOnly ? 0 : getSetupFee(decoration, quantity, sameLogoBefore);
  const unitTotal = product.basePrice + unitDecorationPrice;
  const lineTotal = quantity * unitTotal + setupFee;
  const selectedColor =
    product.colors.find((c) => c.colorName === colorName) ?? product.colors[0];
  // Hats default off (see lib/pricing-store.ts's DEFAULT_DESIGNER_SETTINGS)
  // unless the site-wide Settings tab or a per-item override turns it on.
  const liveDesignerEnabled = data?.liveDesignerEnabled ?? false;

  function handleArtworkFile(file: File | null) {
    setArtworkFileName(file?.name ?? "");
    setLayerPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return undefined;
    });
    if (!file) {
      setArtworkLayer(null);
      setArtworkAspect(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    const place = (aspect: number) => {
      setArtworkAspect(aspect);
      if (selectedZone) setArtworkLayer({ ...fitZoneBox(selectedZone, aspect), rotation: 0 });
      setLayerPreviewUrl(url);
    };
    img.onload = () => place(img.naturalHeight / img.naturalWidth || 1);
    img.onerror = () => place(1);
    img.src = url;
  }

  const artworkPlacement: ArtworkPlacement | undefined =
    liveDesignerEnabled && artworkLayer && selectedZone
      ? {
          zoneId: selectedZone.id,
          zoneLabel: selectedZone.label,
          view: selectedZone.view,
          xPct: (artworkLayer.x + artworkLayer.width / 2 - selectedZone.x) / selectedZone.width,
          yPct: (artworkLayer.y + artworkLayer.height / 2 - selectedZone.y) / selectedZone.height,
          scale: artworkLayer.width / selectedZone.width,
        }
      : undefined;

  function handleAddToCart() {
    if (belowMinimum) return;
    addCartLine({
      styleNumber: product!.styleNumber,
      productType: product!.productType,
      colorName,
      quantity,
      decoration: {
        decorationId: decoration!.id,
        placement,
        artworkFileName: artworkFileName || undefined,
        artworkPlacement,
        notes: notes || undefined,
        priceColumnId: isQuoteOnly ? undefined : priceColumnId || undefined,
        quoteRequired: decoration!.quoteRequired || undefined,
        unknownStitchCount: isUnknownStitchCount || undefined,
      },
      unitBasePrice: product!.basePrice,
      unitDecorationPrice,
      setupFee,
      lineTotal,
    });
    router.push("/cart");
  }

  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8">
      {/* Preview */}
      <div>
        <div
          ref={canvasRef}
          className="relative w-full aspect-square rounded-2xl overflow-hidden bg-white border border-navy/10 p-8"
        >
          <Image
            src={
              selectedColor.imageIsOverride
                ? selectedColor.imageUrl
                : productImageUrl(selectedColor.imageUrl, selectedColor.imageFallbackUrl)
            }
            alt={product.productName}
            fill
            unoptimized
            className="object-contain pointer-events-none"
            sizes="380px"
          />
          {liveDesignerEnabled && selectedZone && (
            <div
              className="absolute rounded-sm border border-[#22c55e]/55 pointer-events-none"
              style={{
                left: `${selectedZone.x}%`,
                top: `${selectedZone.y}%`,
                width: `${selectedZone.width}%`,
                height: `${selectedZone.height}%`,
              }}
            >
              <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-[#15803d] whitespace-nowrap px-1">
                {selectedZone.label}
              </span>
            </div>
          )}
          {liveDesignerEnabled && artworkLayer && (
            <DragResizeBox
              containerRef={canvasRef}
              box={artworkLayer}
              rotation={artworkLayer.rotation}
              onRotate={(deg) => setArtworkLayer((l) => (l ? { ...l, rotation: deg } : l))}
              onChange={(b) => setArtworkLayer((l) => (l ? { ...l, ...b } : l))}
              minSize={3}
              className="border border-red/60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={layerPreviewUrl}
                alt="Your artwork"
                className="w-full h-full object-contain pointer-events-none"
                draggable={false}
              />
            </DragResizeBox>
          )}
        </div>
        {liveDesignerEnabled && artworkLayer && (
          <p className="mt-1.5 text-center text-xs text-navy/50">
            Drag to move, corner handle to resize, top-right dot to rotate.
          </p>
        )}
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-navy/40">
            {product.brandName} · {product.styleNumber}
          </div>
          <div className="font-semibold text-lg text-navy">{product.productName}</div>
          <p className="mt-1 text-sm text-navy/60">{product.description}</p>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-8">
        {/* Color */}
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading font-semibold text-navy">Color</h2>
            <span className="text-sm text-navy/60">{colorName}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2.5">
            {product.colors.map((c) => (
              <div key={c.colorName} className="group relative">
                <button
                  type="button"
                  onClick={() => setColorName(c.colorName)}
                  aria-label={c.colorName}
                  className={`w-7 h-7 rounded-full border transition ${
                    colorName === c.colorName
                      ? "border-navy ring-2 ring-red ring-offset-2 ring-offset-white"
                      : "border-black/10 hover:scale-110"
                  }`}
                  style={swatchBackground(c.colorHexes)}
                />
                <span className="pointer-events-none absolute left-1/2 -top-8 -translate-x-1/2 whitespace-nowrap rounded bg-navy px-2 py-1 text-xs text-white opacity-0 shadow transition group-hover:opacity-100 z-20">
                  {c.colorName}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Decoration type */}
        <section>
          <h2 className="font-heading font-semibold text-navy">Decoration method</h2>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {decorations.map((d) => (
              <button
                key={d.id}
                onClick={() => setDecorationId(d.id)}
                className={`relative overflow-hidden text-left p-4 pt-5 rounded-xl border transition ${
                  decorationId === d.id
                    ? "border-red ring-1 ring-red bg-white"
                    : "border-navy/15 bg-white hover:border-navy/30 hover:bg-gray"
                }`}
              >
                <span className="absolute inset-x-0 top-0 h-1 bg-tan" aria-hidden="true" />
                <div className="flex items-center gap-2">
                  <div className="font-heading font-semibold text-navy">{d.shortLabel}</div>
                  {d.quoteRequired && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-navy bg-tan/25 border border-tan/40 px-1.5 py-0.5 rounded">
                      Custom quote
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-navy/60 leading-relaxed">
                  {d.description}
                </p>
                <div className="mt-2 text-xs text-navy/40">{d.turnaroundDays}</div>
              </button>
            ))}
          </div>
          {decoration.quoteRequired && (
            <p className="mt-3 text-sm text-navy/60 bg-gray border border-navy/10 rounded-lg px-3 py-2">
              Pricing for {decoration.shortLabel} depends on your design, so there&apos;s no
              automatic price shown below. Add your details and quantity and we&apos;ll follow
              up with a quote before production.
            </p>
          )}
          {!decoration.quoteRequired && decoration.priceColumns && decoration.priceColumns.length > 0 && (
            <div className="mt-3">
              <div className="text-sm text-navy/70">Stitch count / pricing tier</div>
              {isUnknownStitchCount ? (
                <p className="mt-2 text-sm text-navy/60 bg-gray border border-navy/10 rounded-lg px-3 py-2">
                  No problem — we&apos;ll follow up with an accurate quote once we&apos;ve seen
                  your design&apos;s stitch count.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {decoration.priceColumns.map((col) => (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => setPriceColumnId(col.id)}
                      className={`px-3.5 py-1.5 rounded-full text-sm border transition ${
                        priceColumnId === col.id
                          ? "bg-red text-white border-red"
                          : "bg-white border-navy text-navy hover:bg-gray"
                      }`}
                    >
                      {col.label}
                    </button>
                  ))}
                </div>
              )}
              {decoration.allowUnknownStitchCount && (
                <label className="mt-2 flex items-center gap-2 text-sm text-navy/70">
                  <input
                    type="checkbox"
                    checked={unknownStitchCount}
                    onChange={(e) => setUnknownStitchCount(e.target.checked)}
                    className="accent-red"
                  />
                  I don&apos;t know how many stitches my design has.
                </label>
              )}
            </div>
          )}
        </section>

        {/* Placement */}
        <section>
          <h2 className="font-heading font-semibold text-navy">Placement</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {decoration.zones.map((z) => (
              <button
                key={z.id}
                onClick={() => setPlacement(z.label)}
                className={`px-3.5 py-1.5 rounded-full text-sm border transition ${
                  placement === z.label
                    ? "bg-red text-white border-red"
                    : "bg-white border-navy text-navy hover:bg-gray"
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>
        </section>

        {/* Artwork */}
        <section>
          <h2 className="font-heading font-semibold text-navy">Your logo / artwork</h2>
          <p className="mt-1 text-xs text-navy/60">
            Accepted: {decoration.acceptedFileTypes.join(", ")}
          </p>
          <input
            type="file"
            accept={decoration.acceptedFileTypes.join(",")}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              if (liveDesignerEnabled) handleArtworkFile(file);
              else setArtworkFileName(file?.name ?? "");
            }}
            className="mt-2 text-sm text-navy/80"
          />
          {artworkFileName && (
            <p className="mt-1 text-sm text-navy/70">Selected: {artworkFileName}</p>
          )}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes for our design team (colors, sizing, placement details)…"
            className="mt-3 w-full bg-white border border-navy/30 rounded-lg p-3 text-sm resize-none h-20 focus:outline-none focus:border-red focus:ring-2 focus:ring-red/20"
          />
          <label className="mt-3 flex items-center gap-2 text-sm text-navy/70">
            <input
              type="checkbox"
              checked={sameLogoBefore}
              onChange={(e) => setSameLogoBefore(e.target.checked)}
              className="accent-red"
            />
            I&apos;ve ordered with this exact logo before (waives the setup fee)
          </label>
        </section>

        {/* Quantity */}
        <section>
          <h2 className="font-heading font-semibold text-navy">Quantity</h2>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              className="w-28 bg-white border border-navy/30 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red focus:ring-2 focus:ring-red/20"
            />
            <span className="text-sm text-navy/60">
              units · minimum {decoration.minQuantity} for {decoration.shortLabel}
            </span>
          </div>
          {belowMinimum && (
            <p className="mt-2 text-sm text-red font-medium">
              {decoration.shortLabel} requires at least {decoration.minQuantity} units.
            </p>
          )}
          {!isQuoteOnly && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-navy/60">
              {decoration.pricingTiers.map((t) => (
                <span
                  key={t.minQty}
                  className={`px-2 py-1 rounded border ${
                    quantity >= t.minQty
                      ? "border-red bg-red/5 text-red font-semibold"
                      : "border-navy/15 text-navy/50"
                  }`}
                >
                  {t.minQty}+ · {formatUSD(t.pricePerUnit)}/ea
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Price summary */}
        <section className="border border-navy/10 rounded-xl bg-white p-5">
          <div className="flex justify-between text-sm text-navy/70">
            <span>{product.productName} ({product.styleNumber}) × {quantity}</span>
            <span className="text-black">{formatUSD(product.basePrice * quantity)}</span>
          </div>
          <div className="flex justify-between text-sm text-navy/70 mt-1">
            <span>{decoration.shortLabel} × {quantity}</span>
            <span className="text-black">
              {isQuoteOnly ? "Contact us for a quote" : formatUSD(unitDecorationPrice * quantity)}
            </span>
          </div>
          <div className="flex justify-between text-sm text-navy/70 mt-1">
            <span>Setup / digitization fee</span>
            <span className="text-black">
              {isQuoteOnly ? "Included in quote" : setupFee === 0 ? "Waived" : formatUSD(setupFee)}
            </span>
          </div>
          {isQuoteOnly && (
            <p className="mt-2 text-xs text-navy/50">
              The line total below only reflects the blank {product.productName.toLowerCase()} —
              we&apos;ll reach out with {decoration.shortLabel.toLowerCase()} pricing before we
              charge or produce anything.
            </p>
          )}
          <div className="flex justify-between font-semibold text-black mt-3 pt-3 border-t border-navy/10">
            <span>Line total</span>
            <span>{formatUSD(lineTotal)}</span>
          </div>

          <button
            onClick={handleAddToCart}
            disabled={belowMinimum}
            className="mt-4 w-full py-3 rounded-md bg-red text-white font-heading font-semibold hover:bg-red-dark transition disabled:bg-navy/20 disabled:text-white/60 disabled:cursor-not-allowed"
          >
            Add to Cart →
          </button>
        </section>
      </div>
    </div>
  );
}
