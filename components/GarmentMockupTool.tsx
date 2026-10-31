"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product, ProductColor } from "@/lib/types";
import type { MockupSearchResult } from "@/app/api/admin/mockup/search/route";
import { productImageUrl, productPreviewImageUrl } from "@/lib/product-image";
import {
  detectGarmentBounds,
  layoutForPreset,
  onModelGarmentBounds,
  loadImage,
  presetsFor,
  comboFor,
  combineGrid,
  COMBO_ID,
  printWidthIn,
  readTaggedDpi,
  assessResolution,
  RECOMMENDED_DPI,
  renderMockup,
  trimTransparent,
  type LogoLayout,
  type PlacementPreset,
  type Rect,
} from "@/lib/garment-mockup";

// ---------------------------------------------------------------------------
// Garment Mockup Tool (admin): blank photo + logo + placement → proof PNG.
// Blank comes from an upload or from the FULL SanMar and S&S Activewear
// catalogs (not the storefront's curated list) via /api/admin/mockup/*.
// Placement must be chosen before Generate is enabled. After generating, the
// logo can be dragged, resized and nudged before downloading.
// ---------------------------------------------------------------------------

type SupplierFilter = "all" | "sanmar" | "ss";
const SUPPLIER_TABS: { id: SupplierFilter; label: string }[] = [
  { id: "all", label: "All suppliers" },
  { id: "sanmar", label: "SanMar" },
  { id: "ss", label: "S&S Activewear" },
];
const SOURCE_LABEL = { sanmar: "SanMar", ss: "S&S" } as const;

type BlankSource = "upload" | "catalog";

type Panel = {
  preset: PlacementPreset;
  base: HTMLImageElement;
  garment: Rect;
  layout: LogoLayout; // in base-photo px
  sizePct: number;
  note: string | null;
  colorName: string | null; // catalog color this view shows (null for uploads)
};

function readFileAsUrl(file: File): string {
  return URL.createObjectURL(file);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const card = "rounded-2xl border border-admin-ink/20 bg-admin-card p-4 sm:p-5";
const stepTitle = "font-heading text-base font-semibold uppercase tracking-wide";
const btn =
  "rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed";
const btnPrimary = `${btn} bg-admin-accent text-admin-accent-ink hover:bg-admin-accent-dim`;
const btnGhost = `${btn} border border-admin-ink/30 hover:bg-admin-ink/10`;

export default function GarmentMockupTool() {
  // ---- Step 1: blank ------------------------------------------------------
  const [source, setSource] = useState<BlankSource>("upload");
  const [uploadFront, setUploadFront] = useState<{ url: string; name: string } | null>(null);
  const [uploadBack, setUploadBack] = useState<{ url: string; name: string } | null>(null);
  const [uploadSide, setUploadSide] = useState<{ url: string; name: string } | null>(null);
  const [isHat, setIsHat] = useState(false);

  const [supplier, setSupplier] = useState<SupplierFilter>("all");
  const [search, setSearch] = useState("");
  // Results are tagged with the query+supplier they answer, so a stale
  // response never shows under a newer query.
  const [searchState, setSearchState] = useState<{
    key: string;
    results: MockupSearchResult[];
    errors: string[];
  } | null>(null);
  const [picked, setPicked] = useState<MockupSearchResult | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [productLoading, setProductLoading] = useState(false);
  const [color, setColor] = useState<ProductColor | null>(null);
  // Multi-color mode: same logo + placement mocked up on several colors.
  const [multiColor, setMultiColor] = useState(false);
  const [colorSet, setColorSet] = useState<ProductColor[]>([]);
  const [syncColors, setSyncColors] = useState(true);

  // ---- Step 2: logo -------------------------------------------------------
  const [logo, setLogo] = useState<{ url: string; name: string } | null>(null);
  // Pixel size of the artwork (transparent padding trimmed) + the dpi the
  // file is tagged with, read as soon as the logo is picked.
  const [logoInfo, setLogoInfo] = useState<{
    url: string;
    width: number;
    height: number;
    taggedDpi: number | null;
  } | null>(null);

  async function pickLogo(f: { url: string; name: string } | null) {
    setLogo(f);
    setLogoInfo(null);
    if (!f) return;
    try {
      const [buf, img] = await Promise.all([
        fetch(f.url).then((r) => r.arrayBuffer()),
        loadImage(f.url),
      ]);
      const trimmed = trimTransparent(img);
      setLogoInfo({ url: f.url, width: trimmed.width, height: trimmed.height, taggedDpi: readTaggedDpi(buf) });
    } catch {
      /* resolution info is advisory only */
    }
  }

  // ---- Step 3: placement --------------------------------------------------
  const [placementId, setPlacementId] = useState<string | null>(null);

  // ---- Step 4: result -----------------------------------------------------
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoCanvas, setLogoCanvas] = useState<HTMLCanvasElement | null>(null);
  // One panel per generated view: a single placement makes one, "Front +
  // Back" makes two. The editor controls act on the active panel.
  const [panels, setPanels] = useState<Panel[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const panel = panels[activeIdx] ?? null;
  const base = panel?.base ?? null;
  const garment = panel?.garment ?? null;
  const layout = panel?.layout ?? null;
  const activePreset = panel?.preset ?? null;
  const sizePct = panel?.sizePct ?? 100;
  const note = panel?.note ?? null;
  // With "same placement on every color" on, an edit applies to every
  // color's view of the same placement (front edits all fronts, etc.).
  const updatePanel = useCallback(
    (patch: Partial<Panel>) =>
      setPanels((ps) => {
        const target = ps[activeIdx];
        return ps.map((p, i) =>
          i === activeIdx || (syncColors && target && p.preset.id === target.preset.id) ? { ...p, ...patch } : p
        );
      }),
    [activeIdx, syncColors]
  );
  const setLayout = useCallback((l: LogoLayout) => updatePanel({ layout: l }), [updatePanel]);
  const [fabricBlend, setFabricBlend] = useState(35);
  const [raised, setRaised] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sleeve/side placements only exist for uploads (supplier feeds have no side photos).
  const presets = useMemo(
    () => presetsFor(isHat ? "upload-hat" : "upload-garment", source === "upload"),
    [isHat, source]
  );
  const combo = useMemo(() => comboFor(isHat), [isHat]);
  // A placement that doesn't exist for the chosen item type counts as unset.
  const preset = presets.find((p) => p.id === placementId) ?? null;
  const selectedPresets: PlacementPreset[] =
    placementId === COMBO_ID ? combo.presets : preset ? [preset] : [];


  // ---- full-catalog search (SanMar feed + S&S live API) -----------------
  const query = search.trim();
  const searchKey = `${supplier}::${query.toLowerCase()}`;
  useEffect(() => {
    if (source !== "catalog" || query.length < 2) return;
    const key = searchKey;
    const t = setTimeout(() => {
      fetch(`/api/admin/mockup/search?q=${encodeURIComponent(query)}&source=${supplier}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: { results: MockupSearchResult[]; errors: string[] }) =>
          setSearchState({ key, results: d.results, errors: d.errors ?? [] })
        )
        .catch(() => setSearchState({ key, results: [], errors: ["Search failed — try again."] }));
    }, 300);
    return () => clearTimeout(t);
  }, [source, query, supplier, searchKey]);
  const searching = query.length >= 2 && searchState?.key !== searchKey;
  const results = searchState?.key === searchKey ? searchState.results : [];
  const searchErrors = searchState?.key === searchKey ? searchState.errors : [];

  async function chooseProduct(r: MockupSearchResult) {
    setPicked(r);
    setProduct(null);
    setColor(null);
    setColorSet([]);
    setProductError(null);
    setProductLoading(true);
    try {
      const res = await fetch(
        `/api/admin/mockup/product?source=${r.source}&style=${encodeURIComponent(r.styleNumber)}`
      );
      const data = (await res.json()) as { product?: Product; error?: string };
      if (!res.ok || !data.product) throw new Error(data.error ?? "Couldn't load that style.");
      setProduct(data.product);
      setColor(data.product.colors[0] ?? null);
      setColorSet(data.product.colors[0] ? [data.product.colors[0]] : []);
      setIsHat(data.product.productType === "hat");
    } catch (e) {
      setProductError(e instanceof Error ? e.message : "Couldn't load that style.");
    } finally {
      setProductLoading(false);
    }
  }

  // ---- resolve the blank image for the chosen view -----------------------
  async function resolveBlank(
    view: "front" | "back" | "side",
    color: ProductColor | null
  ): Promise<{ img: HTMLImageElement; note?: string; onModel?: boolean }> {
    if (source === "upload" && view === "side") {
      if (!uploadSide) throw new Error("Upload a sleeve / side photo for this placement.");
      return { img: await loadImage(uploadSide.url) };
    }
    if (source === "upload") {
      const pick = view === "back" && uploadBack ? uploadBack : uploadFront;
      if (!pick) throw new Error("Upload a blank photo first.");
      const img = await loadImage(pick.url);
      const n =
        view === "back" && !uploadBack
          ? "Using your uploaded photo for the back — upload a back photo if this one shows the front."
          : undefined;
      return { img, note: n };
    }
    if (!color) throw new Error("Pick a product and color first.");
    if (view === "back") {
      if (!color.backImageUrl) throw new Error("No back photo for this item — switch to Upload and add one.");
      const url = color.backImageIsOverride
        ? color.backImageUrl
        : `${productImageUrl(color.backImageUrl)}&strict=1`;
      try {
        return { img: await loadImage(url) };
      } catch {
        throw new Error(`The supplier has no back photo for ${color.colorName} — switch to Upload and add one.`);
      }
    }
    if (color.imageIsOverride) return { img: await loadImage(color.imageUrl) };
    try {
      return { img: await loadImage(`${productImageUrl(color.imageUrl)}&strict=1`) };
    } catch {
      if (color.imageFallbackUrl) {
        return {
          img: await loadImage(productImageUrl(color.imageFallbackUrl)),
          note: `SanMar has no flat photo for ${color.colorName}, so this uses the on-model photo — placement is approximate, drag to adjust. Upload a flat blank for a cleaner proof.`,
          onModel: true,
        };
      }
      throw new Error(`Couldn't load a photo for ${color.colorName}.`);
    }
  }

  const isCombo = placementId === COMBO_ID;
  const chosenColors: ProductColor[] = multiColor ? colorSet : color ? [color] : [];
  const hasUploadFor = (view: PlacementPreset["view"]) =>
    view === "side"
      ? Boolean(uploadSide)
      : view === "back"
        ? // Front + Back needs a real back photo; a lone Back placement can reuse the front one.
          Boolean(uploadBack || (!isCombo && uploadFront))
        : Boolean(uploadFront);
  const canGenerate =
    Boolean(logo) &&
    selectedPresets.length > 0 &&
    (source === "upload" ? selectedPresets.every((p) => hasUploadFor(p.view)) : chosenColors.length > 0);

  async function generate() {
    if (!selectedPresets.length || !logo) return;
    setGenerating(true);
    setError(null);
    try {
      // Every (color, placement) pair becomes a view, grouped by color.
      const colorsToUse: (ProductColor | null)[] = source === "catalog" ? chosenColors : [null];
      const jobs = colorsToUse.flatMap((c) => selectedPresets.map((p) => ({ c, p })));
      const [blanks, logoImg] = await Promise.all([
        Promise.all(jobs.map(({ c, p }) => resolveBlank(p.view, c))),
        loadImage(logo.url),
      ]);
      const trimmed = trimTransparent(logoImg);
      const next: Panel[] = jobs.map(({ c, p }, i) => {
        const { img, note: n, onModel } = blanks[i];
        const detected = detectGarmentBounds(img);
        const g = onModel ? onModelGarmentBounds(detected) : detected;
        return {
          preset: p,
          base: img,
          garment: g,
          layout: layoutForPreset(p, g, trimmed.width, trimmed.height, 100),
          sizePct: 100,
          note: n ?? null,
          colorName: c?.colorName ?? null,
        };
      });
      setLogoCanvas(trimmed);
      setPanels(next);
      setActiveIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setGenerating(false);
    }
  }

  // ---- draw ---------------------------------------------------------------
  const rendered = useMemo(() => {
    if (!base || !logoCanvas || !layout) return null;
    return renderMockup(base, logoCanvas, layout, { fabricBlend, raised });
  }, [base, logoCanvas, layout, fabricBlend, raised]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !rendered) return;
    c.width = rendered.width;
    c.height = rendered.height;
    c.getContext("2d")!.drawImage(rendered, 0, 0);
  }, [rendered]);

  // Resize around the logo's center.
  function applySize(next: number) {
    if (!activePreset || !garment || !logoCanvas || !layout) return;
    const fresh = layoutForPreset(activePreset, garment, logoCanvas.width, logoCanvas.height, next);
    const cx = layout.x + layout.width / 2;
    const cy = layout.y + layout.height / 2;
    updatePanel({ sizePct: next, layout: { ...fresh, x: cx - fresh.width / 2, y: cy - fresh.height / 2 } });
  }

  function resetPlacement() {
    if (!activePreset || !garment || !logoCanvas) return;
    updatePanel({
      sizePct: 100,
      layout: layoutForPreset(activePreset, garment, logoCanvas.width, logoCanvas.height, 100),
    });
  }

  function nudge(dx: number, dy: number) {
    if (!layout || !base) return;
    const step = Math.max(1, Math.round(base.naturalWidth / 300));
    setLayout({ ...layout, x: layout.x + dx * step, y: layout.y + dy * step });
  }

  // Drag the logo directly on the preview.
  const drag = useRef<{ startX: number; startY: number; orig: LogoLayout; scale: number } | null>(null);
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const c = canvasRef.current;
      if (!c || !layout) return;
      const rect = c.getBoundingClientRect();
      if (!base) return;
      // Layout is in base-photo px; the canvas itself is upscaled for export.
      const scale = base.naturalWidth / rect.width;
      const px = (e.clientX - rect.left) * scale;
      const py = (e.clientY - rect.top) * scale;
      const pad = 12 * scale;
      const inside =
        px >= layout.x - pad && px <= layout.x + layout.width + pad &&
        py >= layout.y - pad && py <= layout.y + layout.height + pad;
      if (!inside) return;
      c.setPointerCapture(e.pointerId);
      drag.current = { startX: e.clientX, startY: e.clientY, orig: layout, scale };
    },
    [layout, base]
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const d = drag.current;
      if (!d) return;
      setLayout({
        ...d.orig,
        x: d.orig.x + (e.clientX - d.startX) * d.scale,
        y: d.orig.y + (e.clientY - d.startY) * d.scale,
      });
    },
    [setLayout]
  );
  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  function itemNameFor(view: PlacementPreset["view"], colorName?: string | null): string {
    if (source === "catalog" && product) return `${product.styleNumber}-${colorName ?? color?.colorName ?? ""}`;
    const f = view === "side" ? uploadSide : view === "back" && uploadBack ? uploadBack : uploadFront;
    return f?.name.replace(/\.[^.]+$/, "") ?? "garment";
  }

  function saveCanvas(c: HTMLCanvasElement, filename: string) {
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  }

  const logoSlug = slug(logo?.name.replace(/\.[^.]+$/, "") ?? "logo");

  function download() {
    if (!rendered || !activePreset) return;
    saveCanvas(
      rendered,
      `mockup-${logoSlug}-${slug(itemNameFor(activePreset.view, panel?.colorName))}-${activePreset.id}.png`
    );
  }

  const panelColors = [...new Set(panels.map((p) => p.colorName ?? ""))];
  const presetsPerColor = panelColors.length ? panels.length / panelColors.length : 0;

  function panelLabel(p: Panel): string {
    const view = presetsPerColor > 1 ? (p.preset.view === "back" ? "Back" : "Front") : p.preset.label;
    return p.colorName && panelColors.length > 1 ? `${p.colorName} · ${view}` : presetsPerColor > 1 ? `${view} · ${p.preset.label}` : view;
  }

  function downloadCombined() {
    if (!logoCanvas || panels.length < 2) return;
    const views = panels.map((p) => renderMockup(p.base, logoCanvas, p.layout, { fabricBlend, raised }));
    // One placement: all colors in one row. Several (Front + Back): a row per color.
    const rows: HTMLCanvasElement[][] =
      presetsPerColor > 1
        ? panelColors.map((_, ci) => views.slice(ci * presetsPerColor, (ci + 1) * presetsPerColor))
        : [views];
    const what = presetsPerColor > 1 ? "front-back" : panels[0].preset.id;
    const colorsPart = panelColors.length > 1 ? `${panelColors.length}-colors` : panels[0].colorName ?? "";
    const style = source === "catalog" && product ? product.styleNumber : itemNameFor("front");
    saveCanvas(combineGrid(rows), `mockup-${logoSlug}-${slug(`${style}-${colorsPart}`)}-${what}.png`);
  }

  function fileNameFor(p: Panel): string {
    return `mockup-${logoSlug}-${slug(itemNameFor(p.preset.view, p.colorName))}-${p.preset.id}.png`;
  }

  function downloadPanel(p: Panel) {
    if (!logoCanvas) return;
    saveCanvas(renderMockup(p.base, logoCanvas, p.layout, { fabricBlend, raised }), fileNameFor(p));
  }

  // Each view as its own PNG. Spaced out so browsers don't drop rapid-fire
  // downloads (Chrome may ask once to allow multiple downloads).
  async function downloadEachSeparately() {
    for (let i = 0; i < panels.length; i++) {
      downloadPanel(panels[i]);
      if (i < panels.length - 1) await new Promise((r) => setTimeout(r, 600));
    }
  }

  // ---- UI -----------------------------------------------------------------
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        {/* Step 1 */}
        <section className={card}>
          <h3 className={stepTitle}>1 · Blank item</h3>
          <div className="mt-3 inline-flex rounded-xl border border-admin-ink/30 p-1 text-sm">
            {(["upload", "catalog"] as BlankSource[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`rounded-lg px-3 py-1.5 font-semibold ${
                  source === s ? "bg-admin-accent text-admin-accent-ink" : "hover:bg-admin-ink/10"
                }`}
              >
                {s === "upload" ? "Upload photo" : "From catalog"}
              </button>
            ))}
          </div>

          {source === "upload" ? (
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <FilePick
                label="Blank photo (front)"
                file={uploadFront}
                accept="image/*"
                onPick={setUploadFront}
              />
              <FilePick
                label="Back photo (optional, used for Back placement)"
                file={uploadBack}
                accept="image/*"
                onPick={setUploadBack}
              />
              <FilePick
                label={`${isHat ? "Side profile" : "Sleeve / side"} photo (optional, used for ${isHat ? "Side" : "Sleeve"} placement)`}
                file={uploadSide}
                accept="image/*"
                onPick={setUploadSide}
              />
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap gap-1.5">
                {SUPPLIER_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSupplier(t.id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                      supplier === t.id
                        ? "bg-admin-accent text-admin-accent-ink border-admin-accent"
                        : "border-admin-ink/30 hover:bg-admin-ink/10"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Style # (e.g. ST640, K500, 112), brand or name"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="w-full rounded-xl border border-admin-ink/30 bg-transparent px-3 py-2 placeholder:text-admin-ink/50"
              />
              {query.length > 0 && query.length < 2 && (
                <p className="text-admin-ink/70">Keep typing…</p>
              )}
              {searching && <p className="text-admin-ink/70">Searching the full catalog…</p>}
              {searchErrors.map((e) => (
                <p key={e} className="text-amber-200 text-xs">
                  {e}
                </p>
              ))}
              {!searching && query.length >= 2 && (
                <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
                  {results.map((r) => {
                    const active = picked?.source === r.source && picked.styleNumber === r.styleNumber;
                    return (
                      <button
                        key={`${r.source}-${r.styleNumber}`}
                        type="button"
                        onClick={() => chooseProduct(r)}
                        className={`flex items-center gap-3 rounded-xl border p-1.5 text-left ${
                          active
                            ? "border-admin-accent bg-admin-ink/10 ring-2 ring-admin-accent"
                            : "border-admin-ink/20 hover:bg-admin-ink/10"
                        }`}
                      >
                        <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white">
                          {r.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={productPreviewImageUrl(r.imageUrl)}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-contain"
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">
                            {r.styleNumber}{" "}
                            <span className="ml-1 rounded bg-admin-ink/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                              {SOURCE_LABEL[r.source]}
                            </span>
                          </span>
                          <span className="block truncate text-xs text-admin-ink/70">
                            {r.brand} · {r.name}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {results.length === 0 && searchErrors.length === 0 && (
                    <p className="text-admin-ink/70">No styles match “{query}”.</p>
                  )}
                </div>
              )}
              {productLoading && <p className="text-admin-ink/70">Loading colors…</p>}
              {productError && <p className="text-red-300">{productError}</p>}
              {product && !productLoading && (
                <div className="rounded-xl border border-admin-ink/20 p-3">
                  <div className="flex items-start gap-3">
                    {color?.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={productImageUrl(color.imageUrl, color.imageFallbackUrl)}
                        alt=""
                        className="h-20 w-20 shrink-0 rounded-lg bg-white object-contain"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {product.brandName} {product.styleNumber}
                      </p>
                      <p className="text-xs text-admin-ink/70">{product.productName}</p>
                      {multiColor ? (
                        <p className="mt-1 text-xs">
                          {colorSet.length
                            ? `Colors (${colorSet.length}): ${colorSet.map((c) => c.colorName).join(", ")}`
                            : "Tap colors to add them"}
                        </p>
                      ) : (
                        color && <p className="mt-1 text-xs">Color: {color.colorName}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {product.colors.map((c) => (
                      <button
                        key={c.colorName}
                        type="button"
                        onClick={() => {
                          setColor(c);
                          if (multiColor) {
                            setColorSet((set) =>
                              set.some((x) => x.colorName === c.colorName)
                                ? set.filter((x) => x.colorName !== c.colorName)
                                : [...set, c]
                            );
                          }
                        }}
                        title={c.colorName}
                        aria-label={c.colorName}
                        aria-pressed={
                          multiColor ? colorSet.some((x) => x.colorName === c.colorName) : color?.colorName === c.colorName
                        }
                        className={`relative h-7 w-7 overflow-hidden rounded-full border-2 ${
                          (multiColor ? colorSet.some((x) => x.colorName === c.colorName) : color?.colorName === c.colorName)
                            ? "border-admin-accent ring-2 ring-admin-accent ring-offset-1 ring-offset-admin-card"
                            : "border-admin-ink/20"
                        }`}
                        style={{
                          background:
                            c.colorHexes.length > 1
                              ? `linear-gradient(135deg, ${c.colorHexes[0]} 50%, ${c.colorHexes[1]} 50%)`
                              : c.colorHexes[0] ?? "#ccc",
                        }}
                      />
                    ))}
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={multiColor}
                      onChange={(e) => {
                        setMultiColor(e.target.checked);
                        setColorSet(color ? [color] : []);
                      }}
                    />
                    Mock up several colors (same logo on each)
                  </label>
                </div>
              )}
            </div>
          )}
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isHat} onChange={(e) => setIsHat(e.target.checked)} />
            This is a hat (shows hat placements)
          </label>
        </section>

        {/* Step 2 */}
        <section className={card}>
          <h3 className={stepTitle}>2 · Logo</h3>
          <div className="mt-3 text-sm">
            <FilePick label="Logo (transparent PNG works best)" file={logo} accept="image/*" onPick={pickLogo} preview />
            {logoInfo && logoInfo.url === logo?.url && (
              <LogoResolution
                info={logoInfo}
                placed={
                  layout && activePreset && garment && logoCanvas
                    ? { label: activePreset.label, inches: printWidthIn(activePreset, garment, layout) }
                    : null
                }
              />
            )}
          </div>
        </section>

        {/* Step 3 */}
        <section className={card}>
          <h3 className={stepTitle}>3 · Placement</h3>
          <div className="mt-3 grid gap-2">
            {presets.map((p) => {
              const needsSide = p.view === "side" && !uploadSide;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={needsSide}
                  onClick={() => setPlacementId(p.id)}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                    preset?.id === p.id && !needsSide
                      ? "border-admin-accent bg-admin-accent text-admin-accent-ink"
                      : "border-admin-ink/30 hover:bg-admin-ink/10"
                  }`}
                >
                  <span className="font-semibold">{p.label}</span>
                  <span className="text-right text-xs opacity-70">
                    {needsSide ? `Upload a ${isHat ? "side profile" : "sleeve / side"} photo first` : p.hint}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setPlacementId(COMBO_ID)}
              className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm ${
                isCombo
                  ? "border-admin-accent bg-admin-accent text-admin-accent-ink"
                  : "border-admin-ink/30 hover:bg-admin-ink/10"
              }`}
            >
              <span className="font-semibold">{combo.label}</span>
              <span className="text-right text-xs opacity-70">{combo.hint}</span>
            </button>
          </div>
          {isCombo && source === "upload" && !uploadBack && (
            <p className="mt-2 text-xs text-amber-200">Front + Back needs a back photo. Add one in step 1.</p>
          )}
          <button type="button" disabled={!canGenerate || generating} onClick={generate} className={`${btnPrimary} mt-4 w-full`}>
            {generating ? "Generating…" : "Generate mockup"}
          </button>
          {!canGenerate && (
            <p className="mt-2 text-xs text-admin-ink/70">
              Add a blank, a logo and choose a placement to generate.
            </p>
          )}
          {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
        </section>
      </div>

      {/* Step 4: result */}
      <section className={`${card} flex flex-col`}>
        <h3 className={stepTitle}>4 · Mockup</h3>
        {!rendered ? (
          <div className="mt-3 flex flex-1 min-h-80 items-center justify-center rounded-xl border border-dashed border-admin-ink/30 text-sm text-admin-ink/60">
            Your mockup will appear here.
          </div>
        ) : (
          <>
            {panels.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1 self-start rounded-xl border border-admin-ink/30 p-1 text-sm">
                {panels.map((p, i) => (
                  <button
                    key={`${p.colorName ?? ""}-${p.preset.id}`}
                    type="button"
                    onClick={() => setActiveIdx(i)}
                    className={`rounded-lg px-3 py-1.5 font-semibold ${
                      i === activeIdx ? "bg-admin-accent text-admin-accent-ink" : "hover:bg-admin-ink/10"
                    }`}
                  >
                    {panelLabel(p)}
                  </button>
                ))}
              </div>
            )}
            {note && <p className="mt-2 text-xs text-amber-200">{note}</p>}
            <div className="mt-3 rounded-xl bg-white p-2">
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full cursor-move touch-none"
              />
            </div>
            <p className="mt-1 text-xs text-admin-ink/60">Drag the logo to reposition it.</p>

            <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Size · {sizePct}%</span>
                <input type="range" min={30} max={160} value={sizePct} onChange={(e) => applySize(Number(e.target.value))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Fabric blend · {fabricBlend}%</span>
                <input type="range" min={0} max={100} value={fabricBlend} onChange={(e) => setFabricBlend(Number(e.target.value))} />
              </label>
              <div className="flex items-center gap-1.5">
                <span className="mr-1 font-semibold">Nudge</span>
                {(
                  [
                    ["Left", -1, 0, 180],
                    ["Up", 0, -1, 270],
                    ["Down", 0, 1, 90],
                    ["Right", 1, 0, 0],
                  ] as const
                ).map(([label, dx, dy, rot]) => (
                  <button
                    key={label}
                    type="button"
                    aria-label={`Nudge ${label.toLowerCase()}`}
                    title={`Nudge ${label.toLowerCase()}`}
                    className={`${btnGhost} px-2.5 py-1.5`}
                    onClick={() => nudge(dx, dy)}
                  >
                    {/* Drawn icon rather than an arrow character: some desktop fonts lack ←↑↓→. */}
                    <svg
                      viewBox="0 0 16 16"
                      width="16"
                      height="16"
                      aria-hidden="true"
                      style={{ transform: `rotate(${rot}deg)` }}
                      className="block"
                    >
                      <path
                        d="M2 8h11M9 4l4 4-4 4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={raised} onChange={(e) => setRaised(e.target.checked)} />
                Raised shadow (embroidery / patch look)
              </label>
              {panelColors.length > 1 && (
                <label className="flex items-center gap-2 sm:col-span-2">
                  <input type="checkbox" checked={syncColors} onChange={(e) => setSyncColors(e.target.checked)} />
                  Same placement on every color (moving or resizing one moves them all)
                </label>
              )}
            </div>

            {panels.length > 1 ? (
              <div className="mt-5 flex flex-col gap-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnPrimary} onClick={downloadEachSeparately}>
                    Download each separately ({panels.length} files)
                  </button>
                  <button type="button" className={btnGhost} onClick={downloadCombined}>
                    Download all in one image
                  </button>
                  <button type="button" className={btnGhost} onClick={resetPlacement}>
                    Reset to {activePreset?.label}
                  </button>
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-admin-ink/70">Or download one view:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {panels.map((p) => (
                      <button
                        key={`dl-${p.colorName ?? ""}-${p.preset.id}`}
                        type="button"
                        className={`${btnGhost} px-3 py-1.5 text-xs`}
                        onClick={() => downloadPanel(p)}
                      >
                        {panelLabel(p)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} onClick={download}>
                  Download PNG
                </button>
                <button type="button" className={btnGhost} onClick={resetPlacement}>
                  Reset to {activePreset?.label}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function FilePick({
  label,
  file,
  accept,
  onPick,
  preview,
}: {
  label: string;
  file: { url: string; name: string } | null;
  accept: string;
  onPick: (f: { url: string; name: string } | null) => void;
  preview?: boolean;
}) {
  return (
    <div>
      <span className="block font-semibold">{label}</span>
      <div className="mt-1.5 flex items-center gap-3">
        <label className={`${btnGhost} cursor-pointer`}>
          {file ? "Replace" : "Choose file"}
          <input
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick({ url: readFileAsUrl(f), name: f.name });
              e.target.value = "";
            }}
          />
        </label>
        {file && (
          <>
            {preview && (
              // Checkerboard so a transparent PNG's edges are visible.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.url}
                alt=""
                className="h-12 w-20 rounded-md object-contain"
                style={{
                  background:
                    "repeating-conic-gradient(#d9d9d9 0% 25%, #ffffff 0% 50%) 50% / 12px 12px",
                }}
              />
            )}
            <span className="min-w-0 truncate text-admin-ink/80">{file.name}</span>
            <button type="button" className="text-xs underline opacity-70" onClick={() => onPick(null)}>
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LogoResolution({
  info,
  placed,
}: {
  info: { width: number; height: number; taggedDpi: number | null };
  placed: { label: string; inches: number } | null;
}) {
  const maxSharpIn = info.width / RECOMMENDED_DPI;
  const verdict = placed ? assessResolution(info.width, placed.inches) : null;
  const tone =
    verdict?.level === "low"
      ? "border-red-300/60 bg-red-500/15 text-red-100"
      : verdict?.level === "fair"
        ? "border-amber-300/60 bg-amber-500/15 text-amber-100"
        : verdict
          ? "border-emerald-300/60 bg-emerald-500/15 text-emerald-100"
          : "border-admin-ink/20 text-admin-ink/80";
  return (
    <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-relaxed ${tone}`}>
      <p>
        {info.width} × {info.height} px
        {info.taggedDpi ? ` · file tagged ${info.taggedDpi} dpi` : ""} · sharp (300 dpi) up to{" "}
        {maxSharpIn.toFixed(1)} in wide
      </p>
      {verdict && placed && (
        <p className="mt-1 font-semibold">
          {verdict.level === "good" &&
            `${placed.label} at ~${placed.inches.toFixed(1)} in wide: ${verdict.dpi} dpi. Good.`}
          {verdict.level === "fair" &&
            `${placed.label} at ~${placed.inches.toFixed(1)} in wide: ${verdict.dpi} dpi. Below the recommended 300 dpi, so it may look slightly soft.`}
          {verdict.level === "low" &&
            `Low resolution: ${verdict.dpi} dpi at ~${placed.inches.toFixed(1)} in wide. The mockup will look pixelated. Ask the customer for a larger file or vector art (300 dpi or higher).`}
        </p>
      )}
      {!verdict && info.width < 600 && (
        <p className="mt-1 font-semibold text-amber-100">
          This is a small file. It may look pixelated on anything larger than a left chest.
        </p>
      )}
    </div>
  );
}
