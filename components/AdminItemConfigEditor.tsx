"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import {
  CatalogItemConfig,
  DECORATION_TYPES_BY_PRODUCT,
  DecorationType,
  ItemDecorationSetting,
  ItemImageOverride,
  PlacementZone,
  Product,
} from "@/lib/types";
import { getDecoration } from "@/lib/decorations";
import { resolveImageOverride } from "@/lib/default-item-config";
import DragResizeBox from "./DragResizeBox";
import GarmentPreview, { GarmentPhotoSource } from "./GarmentPreview";

const PHOTO_SOURCE_LABEL: Record<GarmentPhotoSource, string> = {
  override: "Showing your uploaded photo",
  photo: "Showing SanMar's real photo",
  illustration: "SanMar has no photo — showing the illustration",
};

const DEFAULT_ZONE_BY_TYPE = {
  hat: { label: "Front Center", view: "front" as const, x: 30, y: 25, width: 40, height: 30 },
  shirt: { label: "Front Center", view: "front" as const, x: 25, y: 20, width: 50, height: 45 },
};

function emptyConfigFor(product: Product): CatalogItemConfig {
  const types = DECORATION_TYPES_BY_PRODUCT[product.productType];
  const defaultZone = DEFAULT_ZONE_BY_TYPE[product.productType];
  return {
    styleNumber: product.styleNumber,
    decorations: types.map((decorationType) => ({
      decorationType,
      enabled: true,
      zones: [{ id: uuid(), ...defaultZone }],
    })),
  };
}

export default function AdminItemConfigEditor({
  product,
  initialConfig,
  onClose,
  onSaved,
}: {
  product: Product;
  initialConfig: CatalogItemConfig | undefined;
  onClose: () => void;
  onSaved: (config: CatalogItemConfig) => void;
}) {
  const [config, setConfig] = useState<CatalogItemConfig>(
    () => initialConfig ?? emptyConfigFor(product)
  );
  const [expandedType, setExpandedType] = useState<DecorationType | null>(null);
  const [view, setView] = useState<"front" | "back">("front");
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLDivElement>(null);

  const validTypes = DECORATION_TYPES_BY_PRODUCT[product.productType];
  const hero = product.colors[0];
  const hasBack = Boolean(hero?.backImageUrl);

  // --- Design canvas photo (SanMar catalog photo vs. admin-uploaded custom
  // image) -------------------------------------------------------------
  // "*" is the wildcard entry — a custom photo applied to every color that
  // doesn't have its own more specific override. Defaults to that, since
  // "SanMar has no photo for this item at all" is the common case this
  // exists for.
  const WILDCARD = "*";
  const [overrideColorName, setOverrideColorName] = useState<string>(WILDCARD);
  const [uploadingView, setUploadingView] = useState<"front" | "back" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // What actually ended up on screen for each tile — reported by
  // GarmentPreview once it knows whether the photo it tried really loaded.
  const [photoSource, setPhotoSource] = useState<{
    front?: GarmentPhotoSource;
    back?: GarmentPhotoSource;
  }>({});

  const overrideColorOptions = [
    { value: WILDCARD, label: "All colors (fallback)" },
    ...product.colors.map((c) => ({ value: c.colorName, label: c.colorName })),
  ];

  function getOverrideEntry(colorName: string): ItemImageOverride | undefined {
    return config.imageOverrides?.find((o) => o.colorName === colorName);
  }

  function setOverrideEntry(colorName: string, patch: Partial<Omit<ItemImageOverride, "colorName">>) {
    setConfig((c) => {
      const existing = c.imageOverrides ?? [];
      const current = existing.find((o) => o.colorName === colorName);
      const updated: ItemImageOverride = { colorName, frontUrl: current?.frontUrl, backUrl: current?.backUrl, ...patch };
      const cleared = !updated.frontUrl && !updated.backUrl;
      const next = current
        ? cleared
          ? existing.filter((o) => o.colorName !== colorName)
          : existing.map((o) => (o.colorName === colorName ? updated : o))
        : cleared
          ? existing
          : [...existing, updated];
      return { ...c, imageOverrides: next };
    });
  }

  async function handleImageUpload(view: "front" | "back", file: File) {
    setUploadingView(view);
    setUploadError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("styleNumber", product.styleNumber);
      body.append("colorName", overrideColorName);
      body.append("view", view);
      const res = await fetch("/api/admin/item-image", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setOverrideEntry(overrideColorName, view === "front" ? { frontUrl: data.url } : { backUrl: data.url });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setUploadingView(null);
    }
  }

  // What the design canvas will actually show for the currently-selected
  // override color, so the admin previews the same thing a customer would.
  const overrideColor =
    product.colors.find((c) => c.colorName === overrideColorName) ?? hero;
  const resolvedOverride = resolveImageOverride(config.imageOverrides, overrideColorName);
  const effectiveFront = resolvedOverride?.front ?? overrideColor?.imageUrl;
  const effectiveBack = resolvedOverride?.back ?? overrideColor?.backImageUrl;
  // Front and back can each independently have (or lack) a custom photo —
  // keep these separate rather than one combined flag, so a color with only
  // a front override doesn't wrongly treat its (still SanMar-derived) back
  // photo as already-processed.
  const effectiveFrontIsOverride = Boolean(resolvedOverride?.front);
  const effectiveBackIsOverride = Boolean(resolvedOverride?.back);

  // Effective hero image (front) used to draw placement zones against, so
  // zone boxes line up with whatever the customer will actually see —
  // SanMar photo, admin-uploaded photo, or the vector fallback.
  const heroOverride = resolveImageOverride(config.imageOverrides, hero?.colorName ?? "");
  const zoneCanvasFront = heroOverride?.front ?? hero?.imageUrl;
  const zoneCanvasBack = heroOverride?.back ?? hero?.backImageUrl;
  const zoneCanvasFrontIsOverride = Boolean(heroOverride?.front);
  const zoneCanvasBackIsOverride = Boolean(heroOverride?.back);

  const allEnabled = validTypes.every(
    (t) => config.decorations.find((d) => d.decorationType === t)?.enabled
  );

  function getSetting(type: DecorationType): ItemDecorationSetting {
    return (
      config.decorations.find((d) => d.decorationType === type) ?? {
        decorationType: type,
        enabled: false,
        zones: [],
      }
    );
  }

  function updateSetting(type: DecorationType, update: (s: ItemDecorationSetting) => ItemDecorationSetting) {
    setConfig((c) => {
      const existing = c.decorations.find((d) => d.decorationType === type);
      const base: ItemDecorationSetting = existing ?? { decorationType: type, enabled: false, zones: [] };
      const updated = update(base);
      const decorations = existing
        ? c.decorations.map((d) => (d.decorationType === type ? updated : d))
        : [...c.decorations, updated];
      return { ...c, decorations };
    });
  }

  function toggleEnabled(type: DecorationType, enabled: boolean) {
    updateSetting(type, (s) => ({ ...s, enabled }));
    if (enabled) setExpandedType(type);
  }

  function toggleAll(enabled: boolean) {
    setConfig((c) => ({
      ...c,
      decorations: validTypes.map((t) => {
        const existing = c.decorations.find((d) => d.decorationType === t);
        return existing ? { ...existing, enabled } : { decorationType: t, enabled, zones: [] };
      }),
    }));
  }

  function addZone(type: DecorationType) {
    const newZone: PlacementZone = {
      id: uuid(),
      label: "New Zone",
      view,
      x: 30,
      y: 30,
      width: 30,
      height: 25,
    };
    updateSetting(type, (s) => ({ ...s, zones: [...s.zones, newZone] }));
    setSelectedZoneId(newZone.id);
  }

  function updateZone(type: DecorationType, zoneId: string, patch: Partial<PlacementZone>) {
    updateSetting(type, (s) => ({
      ...s,
      zones: s.zones.map((z) => (z.id === zoneId ? { ...z, ...patch } : z)),
    }));
  }

  function removeZone(type: DecorationType, zoneId: string) {
    updateSetting(type, (s) => ({ ...s, zones: s.zones.filter((z) => z.id !== zoneId) }));
    if (selectedZoneId === zoneId) setSelectedZoneId(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/item-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleNumber: product.styleNumber, config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      onSaved(config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const activeSetting = expandedType ? getSetting(expandedType) : null;
  const zonesForView = activeSetting?.zones.filter((z) => z.view === view) ?? [];

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedZoneId(null);
  }, [expandedType, view]);

  return (
    <div className="fixed inset-0 z-50 bg-navy/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-lg text-navy">
              {product.brandName} {product.styleNumber} — {product.productName}
            </h2>
            <p className="text-sm text-navy/60 mt-0.5">
              Configure which decoration types this item offers and where customers can place
              artwork for each.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-navy/50 hover:text-navy text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <label className="mt-5 flex items-center gap-2 text-sm font-medium text-navy border-b border-navy/10 pb-3">
          <input
            type="checkbox"
            checked={allEnabled}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          All
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm border-b border-navy/10 pb-4">
          <span className="text-navy/70 font-medium">Live designer</span>
          {(["default", "on", "off"] as const).map((mode) => {
            const active =
              (mode === "default" && config.liveDesignerOverride === undefined) ||
              (mode === "on" && config.liveDesignerOverride === true) ||
              (mode === "off" && config.liveDesignerOverride === false);
            return (
              <button
                key={mode}
                type="button"
                onClick={() =>
                  setConfig((c) => ({
                    ...c,
                    liveDesignerOverride: mode === "default" ? undefined : mode === "on",
                  }))
                }
                className={`px-3 py-1 rounded-full text-xs border transition ${
                  active
                    ? "bg-navy text-white border-navy"
                    : "border-navy/20 text-navy/70 hover:bg-navy/5"
                }`}
              >
                {mode === "default" ? "Use global setting" : mode === "on" ? "Always on" : "Always off"}
              </button>
            );
          })}
        </div>

        <div className="mt-4 border border-navy/10 rounded-xl p-4">
          <h3 className="font-medium text-navy">Design canvas photo</h3>
          <p className="text-xs text-navy/60 mt-0.5">
            Defaults to SanMar&apos;s photo, or an illustrated shirt if SanMar has
            none. Upload your own instead — pick a color, or &quot;All
            colors&quot; for every color at once.
          </p>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-navy/70">Color</span>
            <select
              value={overrideColorName}
              onChange={(e) => setOverrideColorName(e.target.value)}
              className="border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            >
              {overrideColorOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-3 grid grid-cols-2 gap-3 max-w-md">
            {(["front", "back"] as const)
              .filter((v) => v === "front" || hasBack || product.productType === "shirt")
              .map((v) => {
                const currentUrl = v === "front" ? effectiveFront : effectiveBack;
                const entry = getOverrideEntry(overrideColorName);
                const hasCustom = Boolean(v === "front" ? entry?.frontUrl : entry?.backUrl);
                const isOverrideView = v === "front" ? effectiveFrontIsOverride : effectiveBackIsOverride;
                const source = photoSource[v];
                return (
                  <div key={v}>
                    <div className="relative w-full aspect-square bg-white border border-navy/10 rounded-lg overflow-hidden">
                      <GarmentPreview
                        url={currentUrl}
                        view={v}
                        colorHexes={overrideColor?.colorHexes}
                        isOverride={isOverrideView}
                        onSourceResolved={(s) => setPhotoSource((p) => (p[v] === s ? p : { ...p, [v]: s }))}
                        className="absolute inset-0 w-full h-full object-contain p-3 pointer-events-none"
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs text-navy/60 capitalize">
                        {v} {hasCustom && <span className="text-green-700 font-medium">· custom</span>}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs px-2 py-1 rounded-full border border-navy/20 hover:bg-navy/5 cursor-pointer">
                          {uploadingView === v ? "Uploading…" : hasCustom ? "Replace" : "Upload"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={uploadingView !== null}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (file) handleImageUpload(v, file);
                            }}
                          />
                        </label>
                        {hasCustom && (
                          <button
                            type="button"
                            onClick={() =>
                              setOverrideEntry(
                                overrideColorName,
                                v === "front" ? { frontUrl: undefined } : { backUrl: undefined }
                              )
                            }
                            className="text-xs text-red-600 px-1.5"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    {source && (
                      <p
                        className={`mt-1 text-[11px] ${
                          source === "illustration" ? "text-amber-700" : "text-navy/50"
                        }`}
                      >
                        {PHOTO_SOURCE_LABEL[source]}
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
          {uploadError && <p className="mt-2 text-xs text-red-600">{uploadError}</p>}
        </div>

        <div className="mt-3 space-y-3">
          {validTypes.map((type) => {
            const setting = getSetting(type);
            const info = getDecoration(type);
            const isExpanded = expandedType === type;
            return (
              <div key={type} className="border border-navy/10 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 p-3 bg-navy/[0.02]">
                  <input
                    type="checkbox"
                    checked={setting.enabled}
                    onChange={(e) => toggleEnabled(type, e.target.checked)}
                  />
                  <span className="font-medium text-navy flex-1">
                    {info?.shortLabel ?? type}
                  </span>
                  {setting.enabled && (
                    <button
                      onClick={() => setExpandedType(isExpanded ? null : type)}
                      className="text-sm text-navy/70 px-3 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5"
                    >
                      {isExpanded ? "Hide placements" : `Manage placements (${setting.zones.length})`}
                    </button>
                  )}
                </div>

                {setting.enabled && isExpanded && (
                  <div className="p-4 border-t border-navy/10">
                    {hasBack && (
                      <div className="flex gap-1 mb-3">
                        {(["front", "back"] as const).map((v) => (
                          <button
                            key={v}
                            onClick={() => setView(v)}
                            className={`px-3 py-1 text-xs rounded-full border capitalize ${
                              view === v
                                ? "bg-navy text-white border-navy"
                                : "border-navy/20 text-navy/70"
                            }`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_260px] gap-4">
                      <div
                        ref={imageRef}
                        className="relative w-full aspect-square bg-white border border-navy/10 rounded-lg overflow-hidden"
                      >
                        <GarmentPreview
                          url={view === "back" ? zoneCanvasBack ?? zoneCanvasFront : zoneCanvasFront}
                          view={view}
                          colorHexes={hero?.colorHexes}
                          isOverride={
                            view === "back"
                              ? zoneCanvasBack
                                ? zoneCanvasBackIsOverride
                                : zoneCanvasFrontIsOverride
                              : zoneCanvasFrontIsOverride
                          }
                          className="absolute inset-0 w-full h-full object-contain p-6 pointer-events-none"
                        />
                        {zonesForView.map((z) => (
                          <DragResizeBox
                            key={z.id}
                            containerRef={imageRef}
                            box={z}
                            onChange={(b) => updateZone(type, z.id, b)}
                            onSelect={() => setSelectedZoneId(z.id)}
                            label={z.label}
                            className={`border-2 border-dashed rounded ${
                              selectedZoneId === z.id
                                ? "border-red bg-red/10"
                                : "border-navy/50 bg-navy/5"
                            }`}
                          />
                        ))}
                      </div>

                      <div className="space-y-2">
                        <button
                          onClick={() => addZone(type)}
                          className="w-full text-sm px-3 py-2 rounded-lg border border-navy/20 hover:bg-navy/5"
                        >
                          + Add zone
                        </button>
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {setting.zones.map((z) => (
                            <div
                              key={z.id}
                              onClick={() => {
                                setSelectedZoneId(z.id);
                                setView(z.view);
                              }}
                              className={`p-2 rounded-lg border text-sm cursor-pointer ${
                                selectedZoneId === z.id
                                  ? "border-red ring-1 ring-red"
                                  : "border-navy/10 hover:border-navy/30"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={z.label}
                                  onChange={(e) =>
                                    updateZone(type, z.id, { label: e.target.value })
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex-1 border border-navy/20 rounded px-2 py-1 text-xs"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeZone(type, z.id);
                                  }}
                                  className="text-red-600 text-xs px-1.5"
                                  aria-label={`Delete ${z.label}`}
                                >
                                  ×
                                </button>
                              </div>
                              {hasBack && (
                                <select
                                  value={z.view}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    updateZone(type, z.id, {
                                      view: e.target.value as "front" | "back",
                                    });
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-1.5 text-xs border border-navy/20 rounded px-1.5 py-1"
                                >
                                  <option value="front">Front</option>
                                  <option value="back">Back</option>
                                </select>
                              )}
                            </div>
                          ))}
                          {setting.zones.length === 0 && (
                            <p className="text-xs text-navy/40">No zones yet — add one above.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full border border-navy/20 text-sm font-medium hover:bg-navy/5"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
