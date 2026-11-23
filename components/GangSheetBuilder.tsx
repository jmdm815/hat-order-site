"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import {
  DEFAULT_GAP_IN, DPI, MAX_LENGTH_IN, SHEET_WIDTH_IN, SHOPIFY_STORE,
  checkSheet, effectiveDpi, packItems, rotatedBox, round3, sizeFor, usedLength,
  type Rotation, type SheetAsset, type SheetItem, type SheetSize,
} from "@/lib/gang-sheet";

// ---------------------------------------------------------------------------
// Customer-facing DTF gang sheet builder + uploader.
//   Build: upload designs, set size/qty, auto-arrange or drag on a 24"-wide
//          sheet, quality checks, then add the matching Shopify size to cart.
//   Upload: send an already print-ready sheet; we read its size/dpi.
// ---------------------------------------------------------------------------

type LocalAsset = SheetAsset & {
  previewUrl: string; // object URL for on-screen preview
  status: "uploading" | "ready" | "error";
  progress: number;
  error?: string;
  addW: string; // "Add to sheet" width input (inches)
  addQty: string;
};

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const SNAP = 0.125;
const snap = (n: number) => Math.round(n / SNAP) * SNAP;
const money = (n: number) => `$${n.toFixed(2)}`;
const fmtIn = (n: number) => `${round3(n).toFixed(n % 1 ? 2 : 0)}"`;

// -------------------------------------------------- file inspection helpers
async function readPngDpi(file: File): Promise<number | null> {
  if (file.type !== "image/png") return null;
  const buf = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  for (let i = 8; i < buf.length - 21; ) {
    const len = (buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3];
    const type = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]);
    if (type === "pHYs") {
      const ppu = ((buf[i + 8] << 24) | (buf[i + 9] << 16) | (buf[i + 10] << 8) | buf[i + 11]) >>> 0;
      return buf[i + 16] === 1 ? Math.round(ppu * 0.0254) : null;
    }
    if (type === "IDAT" || len < 0) break;
    i += 12 + len;
  }
  return null;
}

async function inspectImage(file: File, url: string) {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  let pxW = img.naturalWidth, pxH = img.naturalHeight;
  const isVector = file.type === "image/svg+xml";
  if (isVector && (!pxW || !pxH)) { pxW = 1000; pxH = 1000; }
  let hasTransparency = file.type !== "image/jpeg";
  if (hasTransparency && !isVector) {
    try {
      const s = Math.min(1, 400 / Math.max(pxW, pxH));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(pxW * s)); c.height = Math.max(1, Math.round(pxH * s));
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      hasTransparency = false;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { hasTransparency = true; break; }
    } catch { /* keep default */ }
  }
  return { pxW, pxH, isVector, hasTransparency };
}

async function uploadToBlob(file: File, onProgress: (p: number) => void) {
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "art.png";
  const res = await upload(`gang-sheets/uploads/${safe}`, file, {
    access: "private",
    handleUploadUrl: "/api/gang-sheet/upload",
    contentType: file.type || "image/png",
    multipart: file.size > 20 * 1024 * 1024,
    onUploadProgress: (e) => onProgress(e.percentage),
  });
  return res.url;
}

// Posts the chosen size to the Shopify cart (cross-site form POST to /cart/add).
function addToShopifyCart(variantId: number, quantity: number, props: Record<string, string>) {
  const f = document.createElement("form");
  f.method = "POST";
  f.action = `${SHOPIFY_STORE}/cart/add`;
  const add = (name: string, value: string) => {
    const i = document.createElement("input");
    i.type = "hidden"; i.name = name; i.value = value; f.appendChild(i);
  };
  add("id", String(variantId));
  add("quantity", String(quantity));
  for (const [k, v] of Object.entries(props)) add(`properties[${k}]`, v);
  add("return_to", "/cart");
  document.body.appendChild(f);
  f.submit();
}

// ===========================================================================
export default function GangSheetBuilder() {
  const [mode, setMode] = useState<"build" | "upload">("build");
  const [sizes, setSizes] = useState<SheetSize[]>([]);
  const [sizesLive, setSizesLive] = useState(true);
  useEffect(() => {
    fetch("/api/gang-sheet/sizes").then((r) => r.json()).then((d) => { setSizes(d.sizes); setSizesLive(d.live); }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#eef1f6] text-admin-ink">
      <header className="bg-[#1c2338] text-white">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <a href={SHOPIFY_STORE} className="text-xs uppercase tracking-[0.18em] text-white/60 hover:text-white">JM Digital Media</a>
            <h1 className="text-xl sm:text-2xl font-extrabold leading-tight">DTF Gang Sheet Builder</h1>
          </div>
          <div className="flex rounded-xl bg-white/10 p-1 text-sm font-semibold">
            {(["build", "upload"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`px-3 sm:px-4 py-2 rounded-lg transition ${mode === m ? "bg-white text-[#1c2338]" : "text-white/80 hover:text-white"}`}>
                {m === "build" ? "Build a sheet" : "Upload a finished sheet"}
              </button>
            ))}
          </div>
        </div>
      </header>
      {!sizesLive && (
        <p className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-3 text-sm text-amber-800">
          We couldn&apos;t reach the store to load live prices. You can still build your sheet; adding to cart may not work until it reconnects.
        </p>
      )}
      {sizes.length === 0 ? (
        <p className="p-10 text-center text-admin-ink/60">Loading sheet sizes…</p>
      ) : mode === "build" ? (
        <BuildMode sizes={sizes} />
      ) : (
        <UploadMode sizes={sizes} />
      )}
    </div>
  );
}

// ===========================================================================
// Build mode
function BuildMode({ sizes }: { sizes: SheetSize[] }) {
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const [items, setItems] = useState<SheetItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [autoSize, setAutoSize] = useState(true);
  const [manualLen, setManualLen] = useState(sizes[0].lengthIn);
  const [gap, setGap] = useState(DEFAULT_GAP_IN);
  const [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const used = usedLength(items);
  const autoFit = sizeFor(sizes, Math.max(used, 0.01));
  const size: SheetSize = autoSize ? autoFit ?? sizes[sizes.length - 1] : sizes.find((s) => s.lengthIn === manualLen) ?? sizes[0];
  const assetsById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const issues = useMemo(() => {
    const list = checkSheet(items, assets, size.lengthIn);
    if (used > MAX_LENGTH_IN + 0.01) list.unshift({ level: "error", message: `Your designs need ${fmtIn(used)} of sheet — the longest sheet is ${MAX_LENGTH_IN}". Remove some or make them smaller.` });
    else if (!autoSize && used > size.lengthIn + 0.01) list.unshift({ level: "error", message: `Designs run ${fmtIn(used)} long — past the ${size.lengthIn}" sheet. Pick a longer sheet or turn on auto size.` });
    return list;
  }, [items, assets, size.lengthIn, used, autoSize]);
  const blocking = issues.filter((i) => i.level === "error");
  const itemIssue = (id: string) => issues.find((i) => i.itemId === id && i.level === "error") ?? issues.find((i) => i.itemId === id);

  // ---------- assets
  const onFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!/^image\/(png|jpeg|webp|svg\+xml|tiff)$/.test(file.type)) { setMessage(`${file.name}: use PNG, JPG, WEBP or SVG.`); continue; }
      const id = uid();
      const previewUrl = URL.createObjectURL(file);
      let info;
      try { info = await inspectImage(file, previewUrl); } catch { setMessage(`Couldn't open ${file.name}.`); continue; }
      const defW = info.isVector ? 4 : Math.min(SHEET_WIDTH_IN - 0.5, Math.max(0.5, info.pxW / DPI));
      const asset: LocalAsset = {
        id, name: file.name, url: "", contentType: file.type, ...info, previewUrl,
        status: "uploading", progress: 0, addW: String(round3(Math.min(defW, 11.5))), addQty: "1",
      };
      setAssets((a) => [...a, asset]);
      uploadToBlob(file, (p) => setAssets((a) => a.map((x) => (x.id === id ? { ...x, progress: p } : x))))
        .then((url) => setAssets((a) => a.map((x) => (x.id === id ? { ...x, url, status: "ready", progress: 100 } : x))))
        .catch((e) => setAssets((a) => a.map((x) => (x.id === id ? { ...x, status: "error", error: e instanceof Error ? e.message : "Upload failed" } : x))));
    }
  }, []);

  const removeAsset = (id: string) => {
    setAssets((a) => a.filter((x) => x.id !== id));
    setItems((it) => it.filter((x) => x.assetId !== id));
  };

  // ---------- placing
  const repack = (all: SheetItem[], g = gap) =>
    packItems(all.map((it) => {
      const art = rotatedBox(it.w, it.h, it.rot); // un-rotate to art size
      return { assetId: it.assetId, w: it.rot % 180 ? art.w : it.w, h: it.rot % 180 ? art.h : it.h, rot: 0 as Rotation };
    }), g, uid);

  function addCopies(a: LocalAsset) {
    const w = Number(a.addW), qty = Math.floor(Number(a.addQty));
    if (!(w > 0) || !(qty > 0)) { setMessage("Enter a width and quantity."); return; }
    const h = round3((w * a.pxH) / a.pxW);
    if (Math.min(w, h) > SHEET_WIDTH_IN) { setMessage(`That's wider than the 24" sheet.`); return; }
    if (qty > 500) { setMessage("Max 500 copies at a time."); return; }
    const reqs = [
      ...items.map((it) => ({ assetId: it.assetId, w: it.rot % 180 ? it.h : it.w, h: it.rot % 180 ? it.w : it.h, rot: 0 as Rotation })),
      ...Array.from({ length: qty }, () => ({ assetId: a.id, w, h, rot: 0 as Rotation })),
    ];
    setItems(packItems(reqs, gap, uid));
    setMessage(null);
  }

  const update = (id: string, patch: Partial<SheetItem>) => setItems((all) => all.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const sel = items.find((i) => i.id === selected) ?? null;
  const selAsset = sel ? assetsById.get(sel.assetId) : undefined;

  function rotateSel() {
    if (!sel) return;
    const rot = ((sel.rot + 90) % 360) as Rotation;
    update(sel.id, { rot, w: sel.h, h: sel.w, x: Math.min(sel.x, Math.max(0, SHEET_WIDTH_IN - sel.h)) });
  }
  function duplicateSel() {
    if (!sel) return;
    const copy = { ...sel, id: uid() };
    const placed = packItems([...items, copy].map((it) => ({ assetId: it.assetId, w: it.rot % 180 ? it.h : it.w, h: it.rot % 180 ? it.w : it.h, rot: 0 as Rotation })), gap, uid);
    setItems(placed);
    setSelected(null);
  }
  function resizeSel(newW: number) {
    if (!sel || !selAsset || !(newW > 0)) return;
    const ratio = sel.h / sel.w;
    const w = Math.min(SHEET_WIDTH_IN, round3(newW));
    update(sel.id, { w, h: round3(w * ratio), x: Math.min(sel.x, Math.max(0, SHEET_WIDTH_IN - w)) });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      const it = items.find((i) => i.id === selected);
      if (!it) return;
      const step = e.shiftKey ? 1 : SNAP;
      if (e.key === "Delete" || e.key === "Backspace") { setItems((all) => all.filter((i) => i.id !== selected)); setSelected(null); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { update(it.id, { x: Math.max(0, it.x - step) }); e.preventDefault(); }
      else if (e.key === "ArrowRight") { update(it.id, { x: Math.min(SHEET_WIDTH_IN - it.w, it.x + step) }); e.preventDefault(); }
      else if (e.key === "ArrowUp") { update(it.id, { y: Math.max(0, it.y - step) }); e.preventDefault(); }
      else if (e.key === "ArrowDown") { update(it.id, { y: it.y + step }); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, items]);

  const uploading = assets.some((a) => a.status === "uploading");
  const failedUpload = assets.some((a) => a.status === "error" && items.some((i) => i.assetId === a.id));

  return (
    <main className="mx-auto max-w-[1400px] px-4 sm:px-6 py-5 grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
      {/* ------------------------------------------------ left panel */}
      <section className="space-y-4 min-w-0">
        <Card title="1. Upload your designs">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-xl border-2 border-dashed border-admin-ink/20 bg-admin-bg/60 px-4 py-6 text-center hover:border-admin-accent"
          >
            <p className="font-semibold">Drop files or click to upload</p>
            <p className="mt-1 text-xs text-admin-ink/60">PNG with a transparent background works best. JPG, WEBP and SVG also work.</p>
            <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }} />
          </div>
          {assets.length > 0 && (
            <ul className="mt-3 space-y-3">
              {assets.map((a) => {
                const count = items.filter((i) => i.assetId === a.id).length;
                const maxSharp = a.isVector ? null : a.pxW / DPI;
                return (
                  <li key={a.id} className="rounded-xl border border-admin-ink/10 p-3">
                    <div className="flex gap-3">
                      <div className="h-16 w-16 flex-none rounded-lg gs-checker grid place-items-center overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.previewUrl} alt="" className="max-h-full max-w-full object-contain" />
                      </div>
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-semibold truncate">{a.name}</p>
                        <p className="text-xs text-admin-ink/60">
                          {a.isVector ? "Vector: sharp at any size" : `${a.pxW}×${a.pxH}px · sharp up to ${maxSharp!.toFixed(1)}" wide`}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-semibold">
                          {!a.hasTransparency && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">No transparent background</span>}
                          {a.status === "uploading" && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">Uploading {Math.round(a.progress)}%</span>}
                          {a.status === "error" && <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">Upload failed</span>}
                          {count > 0 && <span className="rounded bg-admin-ink/5 px-1.5 py-0.5">{count} on sheet</span>}
                        </div>
                      </div>
                      <button onClick={() => removeAsset(a.id)} className="self-start text-admin-ink/40 hover:text-red-600 text-lg leading-none" aria-label={`Remove ${a.name}`}>×</button>
                    </div>
                    <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                      <label className="text-xs text-admin-ink/70">Width (in)
                        <input inputMode="decimal" className="gs-input" value={a.addW} onChange={(e) => setAssets((all) => all.map((x) => (x.id === a.id ? { ...x, addW: e.target.value } : x)))} />
                      </label>
                      <label className="text-xs text-admin-ink/70">Quantity
                        <input inputMode="numeric" className="gs-input" value={a.addQty} onChange={(e) => setAssets((all) => all.map((x) => (x.id === a.id ? { ...x, addQty: e.target.value } : x)))} />
                      </label>
                      <button onClick={() => addCopies(a)} className="gs-btn-primary h-[38px]">Add</button>
                    </div>
                    {Number(a.addW) > 0 && <p className="mt-1 text-[11px] text-admin-ink/50">{Number(a.addW)}&quot; × {round3((Number(a.addW) * a.pxH) / a.pxW)}&quot; each</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="2. Sheet">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoSize} onChange={(e) => { setAutoSize(e.target.checked); if (!e.target.checked) setManualLen(size.lengthIn); }} />
            Pick the smallest sheet that fits automatically
          </label>
          <select disabled={autoSize} value={size.lengthIn} onChange={(e) => setManualLen(Number(e.target.value))} className="gs-input mt-2 disabled:opacity-60">
            {sizes.map((s) => <option key={s.lengthIn} value={s.lengthIn}>{s.label} · {money(s.price)}</option>)}
          </select>
          <p className="mt-2 text-xs text-admin-ink/60">Designs use {fmtIn(used)} of the {size.lengthIn}&quot; length. Sheets are always 24&quot; wide, up to {MAX_LENGTH_IN}&quot; long.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <button onClick={() => { setItems(repack(items)); setSelected(null); }} disabled={!items.length} className="gs-btn">Auto-arrange</button>
            <label className="text-xs text-admin-ink/70 flex items-center gap-1">Spacing
              <select value={gap} onChange={(e) => { const g = Number(e.target.value); setGap(g); if (items.length) setItems(repack(items, g)); }} className="gs-input !mt-0 !w-auto py-1">
                {[0.125, 0.25, 0.375, 0.5].map((g) => <option key={g} value={g}>{g}&quot;</option>)}
              </select>
            </label>
            <button onClick={() => { setItems([]); setSelected(null); }} disabled={!items.length} className="gs-btn text-red-700">Clear sheet</button>
          </div>
        </Card>

        {sel && selAsset && (
          <Card title="Selected design">
            <p className="text-sm font-semibold truncate">{selAsset.name}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-admin-ink/70">Width (in)
                <input key={`w-${sel.id}-${sel.w}`} defaultValue={sel.w} inputMode="decimal" className="gs-input" onBlur={(e) => resizeSel(Number(e.target.value))} onKeyDown={(e) => e.key === "Enter" && resizeSel(Number((e.target as HTMLInputElement).value))} />
              </label>
              <label className="text-xs text-admin-ink/70">Height (in)
                <input key={`h-${sel.id}-${sel.h}`} defaultValue={sel.h} inputMode="decimal" className="gs-input" onBlur={(e) => resizeSel((Number(e.target.value) * sel.w) / sel.h)} onKeyDown={(e) => e.key === "Enter" && resizeSel((Number((e.target as HTMLInputElement).value) * sel.w) / sel.h)} />
              </label>
            </div>
            <p className="mt-1 text-xs text-admin-ink/60">
              Position {fmtIn(sel.x)} from left, {fmtIn(sel.y)} from top · {selAsset.isVector ? "vector" : `${Math.round(effectiveDpi(selAsset, sel))} dpi`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={rotateSel} className="gs-btn">Rotate 90°</button>
              <button onClick={duplicateSel} className="gs-btn">Duplicate</button>
              <button onClick={() => { setItems((all) => all.filter((i) => i.id !== sel.id)); setSelected(null); }} className="gs-btn text-red-700">Delete</button>
            </div>
            <p className="mt-2 text-[11px] text-admin-ink/50">Drag to move, drag the corner to resize. Arrow keys nudge ⅛&quot; (Shift = 1&quot;).</p>
          </Card>
        )}

        <Checkout
          size={size}
          issues={issues}
          disabled={!items.length || blocking.length > 0 || uploading || failedUpload || used > MAX_LENGTH_IN}
          disabledReason={!items.length ? "Add a design to the sheet." : uploading ? "Waiting for uploads to finish…" : failedUpload ? "A design failed to upload. Remove it and upload again." : blocking[0]?.message}
          message={message}
          submit={async (quantity, customer) => {
            const used = new Set(items.map((i) => i.assetId));
            const res = await fetch("/api/gang-sheet/submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "build", lengthIn: size.lengthIn, quantity, customer, items,
                assets: assets.filter((a) => used.has(a.id)).map(({ id, name, url, contentType, pxW, pxH, isVector, hasTransparency }) => ({ id, name, url, contentType, pxW, pxH, isVector, hasTransparency })),
              }),
            });
            return res;
          }}
        />
      </section>

      {/* ------------------------------------------------ sheet canvas */}
      <section className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="font-semibold">{size.label} · {money(size.price)} <span className="font-normal text-admin-ink/60">· {items.length} design{items.length === 1 ? "" : "s"}</span></p>
          <div className="flex items-center gap-1">
            <button className="gs-btn px-2.5" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out">−</button>
            <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button className="gs-btn px-2.5" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom in">+</button>
          </div>
        </div>
        <SheetCanvas
          lengthIn={autoSize ? Math.max(size.lengthIn, used) : size.lengthIn}
          sheetLen={size.lengthIn}
          zoom={zoom}
          items={items}
          assetsById={assetsById}
          selected={selected}
          onSelect={setSelected}
          onChange={update}
          issueFor={itemIssue}
        />
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
function SheetCanvas(props: {
  lengthIn: number; sheetLen: number; zoom: number; items: SheetItem[]; assetsById: Map<string, LocalAsset>;
  selected: string | null; onSelect: (id: string | null) => void; onChange: (id: string, p: Partial<SheetItem>) => void;
  issueFor: (id: string) => { level: "error" | "warn" } | undefined;
}) {
  const { lengthIn, sheetLen, zoom, items, assetsById, selected, onSelect, onChange, issueFor } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(800);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const ppi = Math.max(8, ((wrapW - 2) / SHEET_WIDTH_IN) * zoom); // screen px per inch
  const drag = useRef<{ id: string; kind: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent, it: SheetItem, kind: "move" | "resize") => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onSelect(it.id);
    drag.current = { id: it.id, kind, sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y, ow: it.w, oh: it.h };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / ppi, dy = (e.clientY - d.sy) / ppi;
    if (d.kind === "move") {
      onChange(d.id, { x: round3(Math.min(Math.max(0, snap(d.ox + dx)), SHEET_WIDTH_IN - d.ow)), y: round3(Math.max(0, snap(d.oy + dy))) });
    } else {
      const w = Math.min(SHEET_WIDTH_IN - d.ox, Math.max(0.25, snap(d.ow + dx)));
      onChange(d.id, { w: round3(w), h: round3((w * d.oh) / d.ow) });
    }
  };
  const end = () => { drag.current = null; };

  const height = lengthIn * ppi;
  return (
    <div ref={wrapRef} className="max-h-[calc(100vh-150px)] overflow-auto rounded-xl border border-admin-ink/15 bg-white">
      <div
        className="relative gs-checker"
        style={{ width: SHEET_WIDTH_IN * ppi, height }}
        onPointerDown={() => onSelect(null)}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {/* inch grid every 1" and a bolder line every 12" */}
        <div className="pointer-events-none absolute inset-0" style={{
          backgroundImage: `linear-gradient(to right, rgba(23,32,56,.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(23,32,56,.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(23,32,56,.18) 1px, transparent 1px)`,
          backgroundSize: `${ppi}px ${ppi}px, ${ppi}px ${ppi}px, 100% ${ppi * 12}px`,
        }} />
        {Array.from({ length: Math.floor(lengthIn / 12) }, (_, i) => (
          <span key={i} className="pointer-events-none absolute right-1 text-[10px] font-semibold text-admin-ink/40" style={{ top: (i + 1) * 12 * ppi - 14 }}>{(i + 1) * 12}&quot;</span>
        ))}
        {lengthIn > sheetLen && (
          <div className="pointer-events-none absolute left-0 right-0 border-t-2 border-dashed border-red-500" style={{ top: sheetLen * ppi }}>
            <span className="absolute right-1 -top-5 rounded bg-red-500 px-1.5 text-[10px] font-semibold text-white">End of {sheetLen}&quot; sheet</span>
          </div>
        )}
        {items.map((it) => {
          const a = assetsById.get(it.assetId);
          if (!a) return null;
          const iss = issueFor(it.id);
          const sideways = it.rot % 180 !== 0;
          const artW = (sideways ? it.h : it.w) * ppi, artH = (sideways ? it.w : it.h) * ppi;
          const isSel = selected === it.id;
          return (
            <div
              key={it.id}
              onPointerDown={(e) => onPointerDown(e, it, "move")}
              className={`absolute touch-none select-none cursor-move ${isSel ? "outline outline-2 outline-[#2d6cdf]" : iss?.level === "error" ? "outline outline-2 outline-red-500" : iss ? "outline outline-1 outline-amber-500" : "hover:outline hover:outline-1 hover:outline-[#2d6cdf]/60"}`}
              style={{ left: it.x * ppi, top: it.y * ppi, width: it.w * ppi, height: it.h * ppi }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.previewUrl} alt={a.name} draggable={false} className="pointer-events-none absolute left-1/2 top-1/2 max-w-none" style={{ width: artW, height: artH, transform: `translate(-50%,-50%) rotate(${it.rot}deg)` }} />
              {isSel && (
                <span onPointerDown={(e) => onPointerDown(e, it, "resize")} className="absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-[#2d6cdf]" />
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-12 text-center text-admin-ink/50">
            <p className="text-lg font-semibold">Your 24&quot;-wide sheet</p>
            <p className="text-sm">Upload designs, set a width and quantity, then press Add.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Upload mode
function UploadMode({ sizes }: { sizes: SheetSize[] }) {
  const [file, setFile] = useState<null | { asset: SheetAsset & { previewUrl: string }; dpiMeta: number | null; status: "uploading" | "ready" | "error"; progress: number; error?: string }>(null);
  const [manualLen, setManualLen] = useState<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  async function onFile(f: File) {
    if (!/^image\/(png|jpeg|tiff|webp)$/.test(f.type)) { alert("Upload a PNG (recommended), JPG, TIFF or WEBP."); return; }
    const previewUrl = URL.createObjectURL(f);
    let info;
    try { info = await inspectImage(f, previewUrl); } catch { return; }
    const dpiMeta = await readPngDpi(f);
    const asset = { id: uid(), name: f.name, url: "", contentType: f.type, ...info, previewUrl };
    setFile({ asset, dpiMeta, status: "uploading", progress: 0 });
    setManualLen(null);
    uploadToBlob(f, (p) => setFile((s) => (s ? { ...s, progress: p } : s)))
      .then((url) => setFile((s) => (s ? { ...s, status: "ready", asset: { ...s.asset, url } } : s)))
      .catch((e) => setFile((s) => (s ? { ...s, status: "error", error: e instanceof Error ? e.message : "Upload failed" } : s)));
  }

  const a = file?.asset;
  const lenIn = a ? (a.pxH / a.pxW) * SHEET_WIDTH_IN : 0;
  const effDpi = a ? a.pxW / SHEET_WIDTH_IN : 0;
  const fit = a ? sizeFor(sizes, lenIn - 0.5) : null;
  const size = sizes.find((s) => s.lengthIn === manualLen) ?? fit ?? sizes[0];
  const issues: { level: "error" | "warn"; message: string }[] = [];
  if (a) {
    if (lenIn > MAX_LENGTH_IN + 0.5) issues.push({ level: "error", message: `Your sheet is about ${lenIn.toFixed(1)}" long. The longest sheet is ${MAX_LENGTH_IN}" — split it into two files.` });
    else if (lenIn > size.lengthIn + 0.5) issues.push({ level: "error", message: `Your file is about ${lenIn.toFixed(1)}" long — pick at least the ${fit?.lengthIn}" sheet.` });
    if (effDpi < 150) issues.push({ level: "error", message: `At 24" wide your file is only ${Math.round(effDpi)} dpi (${a.pxW}px wide). It needs to be 7200px wide for 300 dpi.` });
    else if (effDpi < 280) issues.push({ level: "warn", message: `At 24" wide your file is ${Math.round(effDpi)} dpi. 7200px wide (300 dpi) prints sharpest.` });
    if (!a.hasTransparency) issues.push({ level: "warn", message: "No transparent background found, so the whole background will print. Save as PNG with transparency unless that's intended." });
    if (file?.dpiMeta && Math.abs(a.pxW / file.dpiMeta - SHEET_WIDTH_IN) > 0.5) issues.push({ level: "warn", message: `Your file is set to ${(a.pxW / file.dpiMeta).toFixed(1)}" wide at ${file.dpiMeta} dpi. We'll print it scaled to 24" wide.` });
  }
  const blocking = issues.filter((i) => i.level === "error");

  return (
    <main className="mx-auto max-w-[1100px] px-4 sm:px-6 py-5 grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
      <section className="space-y-4 min-w-0">
        <Card title="1. Upload your print-ready sheet">
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }} onClick={() => ref.current?.click()}
            className="cursor-pointer rounded-xl border-2 border-dashed border-admin-ink/20 bg-admin-bg/60 px-4 py-6 text-center hover:border-admin-accent">
            <p className="font-semibold">{a ? "Replace file" : "Drop your sheet or click to upload"}</p>
            <p className="mt-1 text-xs text-admin-ink/60">PNG, 24&quot; wide (7200px at 300 dpi), transparent background, up to {MAX_LENGTH_IN}&quot; long.</p>
            <input ref={ref} type="file" accept="image/png,image/jpeg,image/tiff,image/webp" className="hidden" onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
          </div>
          {a && (
            <div className="mt-3 text-sm space-y-1">
              <p className="font-semibold truncate">{a.name}</p>
              <p className="text-admin-ink/70">{a.pxW}×{a.pxH}px → 24&quot; × {lenIn.toFixed(1)}&quot; at {Math.round(effDpi)} dpi</p>
              {file!.status === "uploading" && <p className="text-blue-700">Uploading {Math.round(file!.progress)}%</p>}
              {file!.status === "error" && <p className="text-red-700">Upload failed: {file!.error}</p>}
            </div>
          )}
        </Card>
        {a && (
          <Card title="2. Sheet size">
            <select value={size.lengthIn} onChange={(e) => setManualLen(Number(e.target.value))} className="gs-input">
              {sizes.map((s) => <option key={s.lengthIn} value={s.lengthIn} disabled={s.lengthIn + 0.5 < lenIn}>{s.label} · {money(s.price)}</option>)}
            </select>
            <p className="mt-2 text-xs text-admin-ink/60">We picked the smallest sheet your file fits on.</p>
          </Card>
        )}
        <Checkout
          size={size}
          issues={issues}
          disabled={!a || file!.status !== "ready" || blocking.length > 0}
          disabledReason={!a ? "Upload your sheet first." : file!.status === "uploading" ? "Waiting for the upload to finish…" : file!.status === "error" ? "The upload failed — try again." : blocking[0]?.message}
          message={null}
          submit={(quantity, customer) => {
            const { previewUrl: _p, ...uploadedSheet } = a!; void _p;
            return fetch("/api/gang-sheet/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "upload", lengthIn: size.lengthIn, quantity, customer, uploadedSheet }) });
          }}
        />
      </section>
      <section className="min-w-0">
        <div className="rounded-xl border border-admin-ink/15 bg-white p-3">
          {a ? (
            <div className="gs-checker mx-auto" style={{ maxWidth: 520 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.previewUrl} alt="Your sheet" className="block w-full" />
            </div>
          ) : (
            <p className="py-16 text-center text-admin-ink/50">Your sheet preview shows here.</p>
          )}
        </div>
      </section>
    </main>
  );
}

// ===========================================================================
function Checkout(props: {
  size: SheetSize;
  issues: { level: "error" | "warn"; message: string }[];
  disabled: boolean;
  disabledReason?: string;
  message: string | null;
  submit: (quantity: number, customer: { name: string; email: string; notes: string }) => Promise<Response>;
}) {
  const { size, issues, disabled, disabledReason, message, submit } = props;
  const [qty, setQty] = useState("1");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = Math.max(1, Math.min(50, Math.floor(Number(qty) || 1)));

  async function go() {
    setBusy(true); setError(null);
    try {
      const res = await submit(q, { name, email, notes });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      if (!data.variantId) throw new Error("We couldn't connect to the store to add this to your cart. Please try again in a minute.");
      const link = `${window.location.origin}/gang-sheet/${data.id}`;
      addToShopifyCart(data.variantId, q, { "Gang sheet": data.number, "Size": `24 x ${data.lengthIn} in`, "Print file": link, "_gang_sheet_id": data.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Card title="3. Add to cart">
      {issues.length > 0 && (
        <ul className="mb-3 space-y-1.5 text-sm">
          {issues.slice(0, 6).map((i, k) => (
            <li key={k} className={`rounded-lg px-2.5 py-1.5 ${i.level === "error" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>{i.message}</li>
          ))}
          {issues.length > 6 && <li className="text-xs text-admin-ink/60">+{issues.length - 6} more</li>}
        </ul>
      )}
      {message && <p className="mb-3 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900">{message}</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-admin-ink/70">Your name<input className="gs-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        <label className="text-xs text-admin-ink/70">Email<input className="gs-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
      </div>
      <label className="mt-2 block text-xs text-admin-ink/70">Notes for us (optional)<textarea className="gs-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="mt-3 flex items-end justify-between gap-3">
        <label className="text-xs text-admin-ink/70">Copies of this sheet
          <input inputMode="numeric" className="gs-input !w-24" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <div className="text-right">
          <p className="text-xs text-admin-ink/60">{size.label} × {q}</p>
          <p className="text-2xl font-extrabold tabular-nums">{money(size.price * q)}</p>
        </div>
      </div>
      <button onClick={go} disabled={disabled || busy} className="gs-btn-primary mt-3 w-full py-3 text-base disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? "Saving your sheet…" : "Add to cart"}
      </button>
      {disabled && disabledReason && <p className="mt-2 text-xs text-admin-ink/60">{disabledReason}</p>}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <p className="mt-2 text-[11px] text-admin-ink/50">You&apos;ll finish checkout on buyjmmedia.com. Your print file is saved with your order.</p>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-admin-ink/10 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-admin-ink/70">{title}</h2>
      {children}
    </div>
  );
}
