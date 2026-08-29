"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import {
  DecorationOption,
  DesignLayer,
  PlacementZone,
  PrintLocation,
  Product,
  SizeQuantity,
} from "@/lib/types";
import { getSetupFee, getUnitPriceForQuantity } from "@/lib/decorations";
import { formatUSD } from "@/lib/pricing";
import { useOrder } from "@/lib/order-context";
import DragResizeBox, { type Box } from "./DragResizeBox";
import GarmentPreview from "./GarmentPreview";

type DecorationWithZones = DecorationOption & { zones: PlacementZone[] };
type LocationOption = { decoration: DecorationWithZones; zone: PlacementZone; key: string };
// Live-editing shape for a print location while the customer is still
// designing — pricing (unitPrice/setupFee) isn't known until the quantity
// step, so it's computed into a real PrintLocation only when adding to cart.
type EditingLocation = Omit<PrintLocation, "unitPrice" | "setupFee">;
type Step = "design" | "quantity" | "review";

function swatchBackground(hexes: string[]): CSSProperties {
  if (hexes.length <= 1) return { backgroundColor: hexes[0] ?? "#9a9a9a" };
  if (hexes.length === 2) {
    return { backgroundImage: `linear-gradient(135deg, ${hexes[0]} 50%, ${hexes[1]} 50%)` };
  }
  const step = 360 / hexes.length;
  const stops = hexes.map((hex, i) => `${hex} ${i * step}deg ${(i + 1) * step}deg`).join(", ");
  return { backgroundImage: `conic-gradient(${stops})` };
}

// Fit a new layer within the zone's bounds (like object-contain) rather
// than always filling the zone's full width — an upload/text box taller
// than the zone would otherwise start partly outside it, and the preview
// frame clips anything outside with overflow-hidden, making it invisible.
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

function RailIcon({
  kind,
}: {
  kind: "colors" | "locations" | "text" | "upload";
}) {
  const common = { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none" as const };
  if (kind === "colors") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 4a8 8 0 0 1 0 16 4 4 0 0 1 0-8 2 2 0 0 0 0-4 4 4 0 0 1 0-4Z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "locations") {
    return (
      <svg {...common}>
        <path
          d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 12 3.5a6.5 6.5 0 0 1 6.5 6.5c0 5.4-6.5 11-6.5 11Z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  if (kind === "text") {
    return (
      <svg {...common}>
        <path d="M5 5.5h14M12 5.5V19M9 19h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path
        d="M12 4v11m0-11 4 4m-4-4-4 4M5 16.5v2A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RailButton({
  icon,
  label,
  active,
  disabled,
  onClick,
  as = "button",
  accept,
  onFile,
}: {
  icon: "colors" | "locations" | "text" | "upload";
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  as?: "button" | "label";
  accept?: string;
  onFile?: (file: File | null) => void;
}) {
  const classes = `flex lg:flex-col items-center gap-1 lg:gap-1.5 px-3 py-2 lg:py-3 rounded-xl text-xs font-medium transition ${
    active
      ? "bg-navy text-white"
      : disabled
      ? "text-navy/25 cursor-not-allowed"
      : "text-navy/70 hover:bg-navy/5 cursor-pointer"
  }`;
  const content = (
    <>
      <RailIcon kind={icon} />
      <span>{label}</span>
    </>
  );
  if (as === "label") {
    return (
      <label className={classes}>
        {content}
        <input
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(e) => onFile?.(e.target.files?.[0] ?? null)}
          className="hidden"
        />
      </label>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={classes}>
      {content}
    </button>
  );
}

export default function ShirtCustomizeForm({
  product,
  decorations,
  liveDesignerEnabled = true,
}: {
  product: Product;
  decorations: DecorationWithZones[];
  // When false (site-wide Settings tab, or a per-item override — see
  // app/api/products/[styleNumber]), layers are still placed (auto-fit to
  // their zone) but aren't draggable/resizable/rotatable — no DragResizeBox,
  // no snap controls. Customers still pick print locations and upload
  // artwork; they just can't fine-tune its position themselves.
  liveDesignerEnabled?: boolean;
}) {
  const router = useRouter();
  const { addCartLine, sameLogoBefore, setSameLogoBefore } = useOrder();

  const [step, setStep] = useState<Step>("design");
  const [furthestStep, setFurthestStep] = useState<Step>("design");
  const [colorName, setColorName] = useState(product.colors[0]?.colorName ?? "");
  const [locations, setLocations] = useState<EditingLocation[]>([]);
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [view, setView] = useState<"front" | "back">("front");
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [layerPreviewUrls, setLayerPreviewUrls] = useState<Record<string, string>>({});
  const [sizeQty, setSizeQty] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [activePanel, setActivePanel] = useState<"colors" | "locations">("locations");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const imageRef = useRef<HTMLDivElement>(null);

  const selectedColor = product.colors.find((c) => c.colorName === colorName) ?? product.colors[0];
  const decorationById = useMemo(
    () => new Map(decorations.map((d) => [d.id, d] as const)),
    [decorations]
  );

  function zoneById(id: string): PlacementZone | undefined {
    for (const d of decorations) {
      const z = d.zones.find((zz) => zz.id === id);
      if (z) return z;
    }
    return undefined;
  }

  const activeLocation = locations.find((l) => l.id === activeLocationId) ?? null;
  const activeZone = activeLocation ? zoneById(activeLocation.zoneId) : undefined;

  const locationOptions: LocationOption[] = useMemo(() => {
    const opts: LocationOption[] = [];
    for (const d of decorations) {
      for (const z of d.zones) opts.push({ decoration: d, zone: z, key: `${d.id}:${z.id}` });
    }
    return opts;
  }, [decorations]);

  // A garment side (front/back) can only carry one decoration *method* at a
  // time (you can't screen print and embroider the same panel) — so once a
  // location exists on a side, only more zones of that same decoration type
  // stay pickable for that side until it's removed.
  const decorationTypeByView = useMemo(() => {
    const map: Partial<Record<"front" | "back", string>> = {};
    for (const l of locations) {
      if (!map[l.view]) map[l.view] = l.decorationId;
    }
    return map;
  }, [locations]);

  const availableToAdd = locationOptions.filter((o) => {
    const alreadyAdded = locations.some(
      (l) => l.decorationId === o.decoration.id && l.zoneId === o.zone.id
    );
    if (alreadyAdded) return false;
    const usedType = decorationTypeByView[o.zone.view];
    if (usedType && usedType !== o.decoration.id) return false;
    return true;
  });

  // Whether this product has any back-view placement zones configured at
  // all (admin-side, see AdminItemConfigEditor) — independent of whether
  // the customer has actually placed anything there yet, so the Back tab
  // is reachable on mobile before a first back location exists.
  const hasBackZone = decorations.some((d) => d.zones.some((z) => z.view === "back"));
  const showViewTabs = hasBackZone;

  // ---- Location management -------------------------------------------------
  function handleAddLocation(opt: LocationOption) {
    const loc: EditingLocation = {
      id: uuid(),
      zoneId: opt.zone.id,
      zoneLabel: opt.zone.label,
      view: opt.zone.view,
      decorationId: opt.decoration.id,
      layers: [],
    };
    setLocations((ls) => [...ls, loc]);
    setActiveLocationId(loc.id);
    setView(opt.zone.view);
    setShowAddPicker(false);
  }

  function handleRemoveLocation(id: string) {
    setLocations((ls) => {
      const loc = ls.find((l) => l.id === id);
      loc?.layers.forEach((layer) => {
        const url = layerPreviewUrls[layer.id];
        if (url) URL.revokeObjectURL(url);
      });
      return ls.filter((l) => l.id !== id);
    });
    if (activeLocationId === id) setActiveLocationId(null);
  }

  function handleStartOver() {
    locations.forEach((loc) =>
      loc.layers.forEach((layer) => {
        const url = layerPreviewUrls[layer.id];
        if (url) URL.revokeObjectURL(url);
      })
    );
    setLocations([]);
    setActiveLocationId(null);
    setLayerPreviewUrls({});
    setColorName(product.colors[0]?.colorName ?? "");
    setView("front");
    setActivePanel("locations");
  }

  function updateLayers(locationId: string, updater: (layers: DesignLayer[]) => DesignLayer[]) {
    setLocations((ls) => ls.map((l) => (l.id === locationId ? { ...l, layers: updater(l.layers) } : l)));
  }

  // ---- Layer management (scoped to the active location) --------------------
  function handleUploadArt(file: File | null) {
    if (!file || !activeLocation || !activeZone) return;
    const locationId = activeLocation.id;
    const url = URL.createObjectURL(file);
    const place = (aspect: number) => {
      const box = fitZoneBox(activeZone, aspect);
      const layer: DesignLayer = { id: uuid(), kind: "image", fileName: file.name, ...box, rotation: 0 };
      setLayerPreviewUrls((m) => ({ ...m, [layer.id]: url }));
      updateLayers(locationId, (layers) => [...layers, layer]);
    };
    const img = new window.Image();
    img.onload = () => place(img.naturalHeight / img.naturalWidth || 1);
    img.onerror = () => place(1);
    img.src = url;
  }

  function handleAddText() {
    if (!activeLocation || !activeZone) return;
    const width = Math.min(activeZone.width, 60);
    const height = Math.min(activeZone.height, 22);
    const layer: DesignLayer = {
      id: uuid(),
      kind: "text",
      text: "Your Text",
      color: "#292e45",
      x: activeZone.x + (activeZone.width - width) / 2,
      y: activeZone.y + (activeZone.height - height) / 2,
      width,
      height,
      rotation: 0,
    };
    updateLayers(activeLocation.id, (layers) => [...layers, layer]);
  }

  function handleRemoveLayer(layerId: string) {
    if (!activeLocation) return;
    const url = layerPreviewUrls[layerId];
    if (url) URL.revokeObjectURL(url);
    updateLayers(activeLocation.id, (layers) => layers.filter((l) => l.id !== layerId));
    setLayerPreviewUrls((m) => {
      const next = { ...m };
      delete next[layerId];
      return next;
    });
  }

  function handleLayerBoxChange(layerId: string, box: Box) {
    if (!activeLocation) return;
    updateLayers(activeLocation.id, (layers) => layers.map((l) => (l.id === layerId ? { ...l, ...box } : l)));
  }

  function handleLayerRotate(layerId: string, rotation: number) {
    if (!activeLocation) return;
    updateLayers(activeLocation.id, (layers) => layers.map((l) => (l.id === layerId ? { ...l, rotation } : l)));
  }

  function handleLayerTextChange(layerId: string, text: string) {
    if (!activeLocation) return;
    updateLayers(activeLocation.id, (layers) => layers.map((l) => (l.id === layerId ? { ...l, text } : l)));
  }

  function handleLayerColorChange(layerId: string, color: string) {
    if (!activeLocation) return;
    updateLayers(activeLocation.id, (layers) => layers.map((l) => (l.id === layerId ? { ...l, color } : l)));
  }

  // ---- Pricing ---------------------------------------------------------
  const totalQuantity = Object.values(sizeQty).reduce((a, b) => a + b, 0);

  const pricedLocations: PrintLocation[] = useMemo(
    () =>
      locations.map((loc) => {
        const opt = decorationById.get(loc.decorationId);
        return {
          ...loc,
          unitPrice: opt ? getUnitPriceForQuantity(opt, totalQuantity || opt.minQuantity) : 0,
          setupFee: opt ? getSetupFee(opt, totalQuantity, sameLogoBefore) : 0,
        };
      }),
    [locations, totalQuantity, sameLogoBefore, decorationById]
  );

  const totalDecorationUnitPrice = pricedLocations.reduce((s, l) => s + l.unitPrice, 0);
  const totalSetupFees = pricedLocations.reduce((s, l) => s + l.setupFee, 0);

  const sizeEntries: SizeQuantity[] = Object.entries(sizeQty)
    .filter(([, q]) => q > 0)
    .map(([size, quantity]) => ({
      size,
      quantity,
      unitBasePrice: selectedColor?.sizes?.find((s) => s.name === size)?.price ?? product.basePrice,
    }));
  const sizeBaseTotal = sizeEntries.reduce((s, e) => s + e.quantity * e.unitBasePrice, 0);
  const avgUnitBasePrice = totalQuantity > 0 ? sizeBaseTotal / totalQuantity : product.basePrice;
  const lineTotal = sizeBaseTotal + totalQuantity * totalDecorationUnitPrice + totalSetupFees;

  const minQuantity = locations.reduce(
    (max, l) => Math.max(max, decorationById.get(l.decorationId)?.minQuantity ?? 0),
    0
  );
  const belowMinimum = totalQuantity > 0 && totalQuantity < minQuantity;

  const canProceedToQuantity = locations.length > 0;
  const canProceedToReview = totalQuantity > 0 && !belowMinimum;
  const canAddToCart = canProceedToQuantity && canProceedToReview && sizeEntries.length > 0;

  function goToStep(next: Step) {
    if (next === "quantity" && !canProceedToQuantity) return;
    if (next === "review" && (!canProceedToQuantity || !canProceedToReview)) return;
    setStep(next);
    const order: Step[] = ["design", "quantity", "review"];
    if (order.indexOf(next) > order.indexOf(furthestStep)) setFurthestStep(next);
  }

  function handleAddToCart() {
    if (!canAddToCart) return;
    addCartLine({
      styleNumber: product.styleNumber,
      productType: "shirt",
      colorName,
      sizes: sizeEntries,
      quantity: totalQuantity,
      printLocations: pricedLocations,
      notes: notes || undefined,
      unitBasePrice: avgUnitBasePrice,
      unitDecorationPrice: totalDecorationUnitPrice,
      setupFee: totalSetupFees,
      lineTotal,
    });
    router.push("/cart");
  }

  const stepMeta: { id: Step; label: string }[] = [
    { id: "design", label: "Design" },
    { id: "quantity", label: "Quantity" },
    { id: "review", label: "Review" },
  ];
  const stepOrder: Step[] = ["design", "quantity", "review"];

  return (
    <div className="mt-6">
      {/* Step tabs */}
      <div className="flex items-center border-b border-navy/10">
        {stepMeta.map((s, i) => {
          const reachable = stepOrder.indexOf(s.id) <= stepOrder.indexOf(furthestStep);
          return (
            <button
              key={s.id}
              onClick={() => reachable && goToStep(s.id)}
              disabled={!reachable}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition ${
                step === s.id
                  ? "border-red text-navy"
                  : reachable
                  ? "border-transparent text-navy/60 hover:text-navy"
                  : "border-transparent text-navy/25 cursor-not-allowed"
              }`}
            >
              <span
                className={`flex items-center justify-center w-5 h-5 rounded-full text-xs ${
                  step === s.id ? "bg-red text-white" : "bg-navy/10 text-navy/50"
                }`}
              >
                {i + 1}
              </span>
              {s.label.toUpperCase()}
            </button>
          );
        })}
      </div>

      {step === "design" && (
        <div className="mt-6 border border-navy/10 rounded-2xl overflow-hidden bg-white">
          {/* Top toolbar */}
          <div className="flex items-center justify-between border-b border-navy/10 px-4 py-2.5 bg-cream/40">
            <button
              type="button"
              onClick={handleStartOver}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-navy/20 text-navy hover:bg-navy/5"
            >
              ↺ Start Over
            </button>
            <div className="text-xs text-navy/50 text-right">
              {product.brandName} · {product.styleNumber}
            </div>
          </div>

          <div className="flex flex-col lg:flex-row">
            {/* Left icon rail */}
            <div className="flex lg:flex-col items-stretch justify-center gap-1 border-b lg:border-b-0 lg:border-r border-navy/10 px-2 py-2 lg:w-20 lg:py-4 shrink-0 bg-cream/20">
              <RailButton
                icon="colors"
                label="Color"
                active={activePanel === "colors"}
                onClick={() => setActivePanel("colors")}
              />
              <RailButton
                icon="locations"
                label="Print Areas"
                active={activePanel === "locations"}
                onClick={() => setActivePanel("locations")}
              />
              <RailButton icon="text" label="Add Text" disabled={!activeLocation} onClick={handleAddText} />
              <RailButton
                icon="upload"
                label="Upload Art"
                as="label"
                disabled={!activeLocation}
                accept={activeLocation ? decorationById.get(activeLocation.decorationId)?.acceptedFileTypes.join(",") : undefined}
                onFile={handleUploadArt}
              />
            </div>

            {/* Manage panel: colors or locations */}
            <div className="lg:w-64 border-b lg:border-b-0 lg:border-r border-navy/10 p-4 shrink-0">
              {activePanel === "colors" ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <h2 className="font-semibold text-navy">Color</h2>
                    <span className="text-sm text-navy/60">{colorName}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    {product.colors.map((c) => (
                      <div key={c.colorName} className="group relative">
                        <button
                          type="button"
                          onClick={() => setColorName(c.colorName)}
                          aria-label={c.colorName}
                          className={`w-8 h-8 rounded-full border transition ${
                            colorName === c.colorName
                              ? "border-navy ring-2 ring-red ring-offset-2 ring-offset-cream"
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
                  <div className="mt-4 text-sm">
                    <div className="font-semibold text-navy">{product.productName}</div>
                    <p className="mt-1 text-xs text-navy/60">{product.description}</p>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="font-semibold text-navy">Print locations</h2>
                  <p className="mt-1 text-xs text-navy/60">
                    Add every spot you want decorated — front, back, sleeve. Each location is priced
                    separately. Upload artwork now for a live mockup, or skip it and just pick
                    locations to get an instant quote — we&apos;ll finalize the design with you after
                    checkout.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {locations.map((loc) => (
                      <button
                        key={loc.id}
                        onClick={() => {
                          setActiveLocationId(loc.id);
                          setView(loc.view);
                        }}
                        className={`flex items-center gap-2 pl-3.5 pr-2 py-1.5 rounded-full text-sm border transition ${
                          activeLocationId === loc.id
                            ? "bg-navy text-white border-red"
                            : "border-navy/20 text-navy/70 hover:bg-navy/5"
                        }`}
                      >
                        {loc.zoneLabel} · {decorationById.get(loc.decorationId)?.shortLabel}
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveLocation(loc.id);
                          }}
                          className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-white/20"
                          aria-label="Remove location"
                        >
                          ×
                        </span>
                      </button>
                    ))}

                    <div className="relative">
                      <button
                        onClick={() => setShowAddPicker((v) => !v)}
                        disabled={availableToAdd.length === 0}
                        className="px-3.5 py-1.5 rounded-full text-sm border border-dashed border-navy/30 text-navy/70 hover:bg-navy/5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        + Add print location
                      </button>
                      {showAddPicker && availableToAdd.length > 0 && (
                        <div className="absolute z-30 mt-1 w-64 bg-white border border-navy/10 rounded-xl shadow-lg p-1.5">
                          {availableToAdd.map((opt) => (
                            <button
                              key={opt.key}
                              onClick={() => handleAddLocation(opt)}
                              className="w-full text-left px-3 py-2 rounded-lg text-sm text-navy hover:bg-navy/5"
                            >
                              {opt.zone.label} · {opt.decoration.shortLabel}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {locations.length === 0 && (
                    <p className="mt-2 text-xs text-navy/50">Add at least one print location to continue.</p>
                  )}
                </>
              )}
            </div>

            {/* Canvas */}
            <div className="flex-1 p-3 lg:p-4 flex items-start justify-center bg-cream/10 min-w-0">
              <div className="w-full">
                <div
                  ref={imageRef}
                  className="relative w-full aspect-square rounded-2xl overflow-hidden bg-white border border-navy/10"
                >
                  <GarmentPreview
                    url={view === "back" ? selectedColor?.backImageUrl : selectedColor?.imageUrl}
                    view={view}
                    colorHexes={selectedColor?.colorHexes}
                    isOverride={
                      view === "back"
                        ? selectedColor?.backImageIsOverride
                        : selectedColor?.imageIsOverride
                    }
                    className="absolute inset-0 w-full h-full object-contain p-6 pointer-events-none"
                  />

                  {locations
                    .filter((l) => l.view === view)
                    .map((loc) => {
                      const zone = zoneById(loc.zoneId);
                      if (!zone) return null;
                      const isActive = loc.id === activeLocationId;
                      const showInteractiveLayers = isActive && liveDesignerEnabled;
                      return (
                        <div key={loc.id}>
                          <div
                            onClick={() => setActiveLocationId(loc.id)}
                            role="button"
                            className={`absolute rounded-sm pointer-events-auto cursor-pointer transition ${
                              isActive
                                ? "border-2 border-[#22c55e] bg-[#22c55e]/10"
                                : "border border-[#22c55e]/55 hover:border-[#22c55e] hover:bg-[#22c55e]/5"
                            }`}
                            style={{
                              left: `${zone.x}%`,
                              top: `${zone.y}%`,
                              width: `${zone.width}%`,
                              height: `${zone.height}%`,
                            }}
                          >
                            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-[#15803d] bg-white/90 whitespace-nowrap px-1.5 py-0.5 rounded pointer-events-none">
                              {loc.zoneLabel} · {decorationById.get(loc.decorationId)?.shortLabel}
                            </span>
                          </div>

                          {loc.layers.map((layer) =>
                            showInteractiveLayers ? (
                              <DragResizeBox
                                key={layer.id}
                                containerRef={imageRef}
                                box={layer}
                                rotation={layer.rotation}
                                onRotate={(deg) => handleLayerRotate(layer.id, deg)}
                                onChange={(b) => handleLayerBoxChange(layer.id, b)}
                                minSize={3}
                                className="border border-red/60"
                                style={{ containerType: "size" }}
                                snapEnabled={snapEnabled}
                                snapTarget={{ x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }}
                              >
                                {layer.kind === "image" ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={layerPreviewUrls[layer.id]}
                                    alt="Your artwork"
                                    className="w-full h-full object-contain pointer-events-none"
                                    draggable={false}
                                  />
                                ) : (
                                  <div
                                    className="w-full h-full flex items-center justify-center text-center font-bold px-1 pointer-events-none"
                                    style={{ color: layer.color, fontSize: "16cqh", lineHeight: 1.1, wordBreak: "break-word" }}
                                  >
                                    {layer.text}
                                  </div>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveLayer(layer.id);
                                  }}
                                  className="absolute -top-3 -left-3 w-6 h-6 rounded-full bg-white border border-navy/20 text-navy text-xs shadow flex items-center justify-center"
                                  aria-label="Remove layer"
                                >
                                  ×
                                </button>
                              </DragResizeBox>
                            ) : (
                              <div
                                key={layer.id}
                                className="absolute pointer-events-none"
                                style={{
                                  left: `${layer.x}%`,
                                  top: `${layer.y}%`,
                                  width: `${layer.width}%`,
                                  height: `${layer.height}%`,
                                  transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                                }}
                              >
                                {layer.kind === "image" ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={layerPreviewUrls[layer.id]}
                                    alt=""
                                    className="w-full h-full object-contain"
                                    draggable={false}
                                  />
                                ) : (
                                  <div
                                    className="w-full h-full flex items-center justify-center text-center font-bold px-1"
                                    style={{ color: layer.color, fontSize: "16cqh", lineHeight: 1.1 }}
                                  >
                                    {layer.text}
                                  </div>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      );
                    })}
                </div>

                {activeLocation && liveDesignerEnabled && (
                  <div className="mt-2 flex flex-col items-center gap-1.5">
                    <p className="text-center text-xs text-navy/50">
                      Editing {activeLocation.zoneLabel} · {decorationById.get(activeLocation.decorationId)?.shortLabel} —
                      drag to move, corner handle to resize, top-right dot to rotate.
                    </p>
                    <label className="flex items-center gap-1.5 text-xs text-navy/60 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={snapEnabled}
                        onChange={(e) => setSnapEnabled(e.target.checked)}
                        className="rounded border-navy/30"
                      />
                      Snap to center while dragging
                    </label>
                  </div>
                )}
                {activeLocation && !liveDesignerEnabled && (
                  <p className="mt-2 text-center text-xs text-navy/50">
                    Editing {activeLocation.zoneLabel} · {decorationById.get(activeLocation.decorationId)?.shortLabel} —
                    artwork is centered in the zone; we&apos;ll finalize exact
                    placement with you after checkout.
                  </p>
                )}
              </div>
            </div>

            {/* Right view thumbnails */}
            <div className="hidden lg:flex flex-col items-center gap-3 border-l border-navy/10 px-3 py-4 w-24 shrink-0">
              <button
                type="button"
                onClick={() => setView("front")}
                className={`w-full rounded-lg border p-1.5 transition ${
                  view === "front" ? "border-navy ring-1 ring-navy" : "border-navy/15 hover:border-navy/30"
                }`}
              >
                <div className="relative w-full aspect-square rounded overflow-hidden bg-white">
                  <GarmentPreview
                    url={selectedColor?.imageUrl}
                    view="front"
                    colorHexes={selectedColor?.colorHexes}
                    isOverride={selectedColor?.imageIsOverride}
                    className="w-full h-full object-contain p-1.5"
                  />
                </div>
                <span className="mt-1 block text-[11px] font-medium text-navy/70">Front</span>
              </button>
              {hasBackZone && (
                <button
                  type="button"
                  onClick={() => setView("back")}
                  className={`w-full rounded-lg border p-1.5 transition ${
                    view === "back" ? "border-navy ring-1 ring-navy" : "border-navy/15 hover:border-navy/30"
                  }`}
                >
                  <div className="relative w-full aspect-square rounded overflow-hidden bg-white">
                    <GarmentPreview
                      url={selectedColor?.backImageUrl}
                      view="back"
                      colorHexes={selectedColor?.colorHexes}
                      isOverride={selectedColor?.backImageIsOverride}
                      className="w-full h-full object-contain p-1.5"
                    />
                  </div>
                  <span className="mt-1 block text-[11px] font-medium text-navy/70">Back</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile front/back toggle (thumbnail rail is desktop-only) */}
          {showViewTabs && (
            <div className="flex lg:hidden gap-1 px-4 pb-3">
              {(["front", "back"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1 text-xs rounded-full border capitalize ${
                    view === v ? "bg-navy text-white border-navy" : "border-navy/20 text-navy/70"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          {/* Artwork layers + notes for the active location */}
          {activeLocation && (
            <div className="border-t border-navy/10 p-4">
              <h2 className="font-semibold text-navy text-sm">
                Layers — {activeLocation.zoneLabel} · {decorationById.get(activeLocation.decorationId)?.shortLabel}
              </h2>
              {activeLocation.layers.length > 0 ? (
                <ul className="mt-2 space-y-2 max-w-xl">
                  {activeLocation.layers.map((layer) => (
                    <li
                      key={layer.id}
                      className="flex items-center gap-2 border border-navy/10 rounded-lg px-3 py-2"
                    >
                      {layer.kind === "image" ? (
                        <span className="text-sm text-navy/70 truncate flex-1">{layer.fileName}</span>
                      ) : (
                        <>
                          <input
                            value={layer.text}
                            onChange={(e) => handleLayerTextChange(layer.id, e.target.value)}
                            className="flex-1 text-sm border border-navy/15 rounded px-2 py-1"
                          />
                          <input
                            type="color"
                            value={layer.color}
                            onChange={(e) => handleLayerColorChange(layer.id, e.target.value)}
                            className="w-7 h-7 rounded border border-navy/15 shrink-0"
                            aria-label="Text color"
                          />
                        </>
                      )}
                      <button
                        onClick={() => handleRemoveLayer(layer.id)}
                        className="text-xs text-red-600 hover:underline shrink-0"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-navy/50">
                  No artwork yet — use Upload Art or Add Text on the left, or leave blank for a quote-only location.
                </p>
              )}
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes for our design team (colors, sizing, placement details)…"
                className="mt-3 w-full max-w-xl border border-navy/20 rounded-lg p-3 text-sm resize-none h-20"
              />
            </div>
          )}

          {/* Bottom action bar */}
          <div className="flex items-center justify-end gap-3 border-t border-navy/10 px-4 py-3 bg-cream/40">
            <button
              onClick={() => goToStep("quantity")}
              disabled={!canProceedToQuantity}
              className="px-6 py-2.5 rounded-full bg-navy text-white font-semibold hover:bg-red transition disabled:bg-navy/20 disabled:cursor-not-allowed"
            >
              Next Step →
            </button>
          </div>
        </div>
      )}

      {step === "quantity" && (
        <div className="mt-6 max-w-xl">
          <h2 className="font-semibold text-navy">How many do you need?</h2>
          <p className="mt-1 text-sm text-navy/60">
            Enter quantities per size. Pricing updates in real time as you go.
          </p>
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-3">
            {(selectedColor?.sizes ?? []).map((s) => (
              <label key={s.name} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-navy/70">
                  {s.name} <span className="text-navy/40">· {formatUSD(s.price)}</span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={sizeQty[s.name] ?? ""}
                  onChange={(e) =>
                    setSizeQty((q) => ({ ...q, [s.name]: Math.max(0, Number(e.target.value) || 0) }))
                  }
                  placeholder="0"
                  className="border border-navy/20 rounded-lg px-2.5 py-2 text-sm"
                />
              </label>
            ))}
          </div>

          {locations.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5 text-xs text-navy/60">
              {minQuantity > 0 && <span>Minimum order: {minQuantity} units ·</span>}
              {pricedLocations[0] &&
                decorationById
                  .get(pricedLocations[0].decorationId)
                  ?.pricingTiers.map((t) => (
                    <span
                      key={t.minQty}
                      className={`px-2 py-1 rounded border ${
                        totalQuantity >= t.minQty ? "border-red text-navy font-medium" : "border-navy/10"
                      }`}
                    >
                      {t.minQty}+ · {formatUSD(t.pricePerUnit)}/ea
                    </span>
                  ))}
            </div>
          )}

          {belowMinimum && (
            <p className="mt-2 text-sm text-red-600">
              This order needs at least {minQuantity} units total ({totalQuantity} entered so far).
            </p>
          )}

          <div className="mt-6 border border-navy/10 rounded-xl bg-white p-4 text-sm text-navy/70">
            <div className="flex justify-between">
              <span>{totalQuantity} items · garment subtotal</span>
              <span>{formatUSD(sizeBaseTotal)}</span>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => goToStep("design")}
              className="px-5 py-3 rounded-full border border-navy/20 text-navy font-semibold hover:bg-navy/5"
            >
              ← Back to Design
            </button>
            <button
              onClick={() => goToStep("review")}
              disabled={!canProceedToReview}
              className="flex-1 py-3 rounded-full bg-navy text-white font-semibold hover:bg-red transition disabled:bg-navy/20 disabled:cursor-not-allowed"
            >
              Calculate Pricing →
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="mt-6 max-w-2xl">
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1.5 rounded-full bg-navy/5 text-navy text-sm font-medium">
              {totalQuantity} items
            </span>
            <span className="px-3 py-1.5 rounded-full bg-navy/5 text-navy text-sm font-medium">
              {locations.length} print {locations.length === 1 ? "area" : "areas"}
            </span>
            <span className="px-3 py-1.5 rounded-full bg-navy/5 text-navy text-sm font-medium">
              {colorName}
            </span>
          </div>

          <div className="mt-5 border border-navy/10 rounded-xl bg-white p-5">
            <div className="flex gap-4">
              <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-cream shrink-0">
                <GarmentPreview
                  url={selectedColor?.imageUrl}
                  view="front"
                  colorHexes={selectedColor?.colorHexes}
                  isOverride={selectedColor?.imageIsOverride}
                  className="w-full h-full object-contain p-2"
                />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-navy">{product.productName}</div>
                <div className="text-xs text-navy/50">
                  {product.styleNumber} · {colorName}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sizeEntries.map((e) => (
                    <span key={e.size} className="text-xs px-2 py-0.5 rounded bg-navy/5 text-navy/70">
                      {e.size}-{e.quantity}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-navy/10 space-y-2">
              <div className="flex justify-between text-sm text-navy/70">
                <span>Garments × {totalQuantity}</span>
                <span>{formatUSD(sizeBaseTotal)}</span>
              </div>
              {pricedLocations.map((loc) => (
                <div key={loc.id} className="flex justify-between text-sm text-navy/70">
                  <span>
                    {loc.zoneLabel} · {decorationById.get(loc.decorationId)?.shortLabel} × {totalQuantity}
                  </span>
                  <span>{formatUSD(loc.unitPrice * totalQuantity)}</span>
                </div>
              ))}
              {pricedLocations.map((loc) => (
                <div key={`${loc.id}-setup`} className="flex justify-between text-sm text-navy/70">
                  <span>{loc.zoneLabel} setup / digitization fee</span>
                  <span>{loc.setupFee === 0 ? "Waived" : formatUSD(loc.setupFee)}</span>
                </div>
              ))}
              <div className="flex justify-between font-semibold text-navy pt-2 border-t border-navy/10">
                <span>Line total</span>
                <span>{formatUSD(lineTotal)}</span>
              </div>
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-navy/70">
              <input
                type="checkbox"
                checked={sameLogoBefore}
                onChange={(e) => setSameLogoBefore(e.target.checked)}
              />
              I&apos;ve ordered with this exact logo before (waives setup fees)
            </label>

            <button
              onClick={handleAddToCart}
              disabled={!canAddToCart}
              className="mt-5 w-full py-3 rounded-full bg-navy text-white font-semibold hover:bg-red transition disabled:bg-navy/20 disabled:cursor-not-allowed"
            >
              Add to Cart →
            </button>
          </div>

          <button
            onClick={() => goToStep("quantity")}
            className="mt-4 px-5 py-2.5 rounded-full border border-navy/20 text-navy font-semibold hover:bg-navy/5"
          >
            ← Back to Quantity
          </button>
        </div>
      )}
    </div>
  );
}
