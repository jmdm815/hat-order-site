"use client";

// AI Mockup Studio UI. Self-contained on purpose (React only, plain Tailwind
// colors) so the exact same file runs in the admin tab, the public page and
// the standalone jm-mockup-studio app — keep it free of repo imports.

import { useMemo, useRef, useState } from "react";

type Op = Record<string, unknown>;
type Plan = { summary: string; colors: { label: string; ops: Op[]; note?: string }[] };
type Item = { label: string; jpg: string; ops: Op[]; note?: string; hex: string; warning?: string };
type Result = { items: Item[]; sheet?: string; summary: string; plan: Plan; logoNote?: string };
type SearchHit = { source: "sanmar" | "ss"; styleNumber: string; name: string; brand: string; image?: string };
type Product = { styleNumber: string; name: string; hat: boolean; colors: { name: string; hexes: string[]; image: string }[] };
type Picked =
  | { kind: "catalog"; source: "sanmar" | "ss"; style: string; color: string; hex?: string; label: string }
  | { kind: "upload"; data: string; label: string };

const MAX_SIDE = 3000;

async function fileToDataUrl(file: File, maxSide = MAX_SIDE): Promise<string> {
  const raw = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) {
    // Rasterize SVGs in the browser so the server always gets a PNG.
    const img = await loadImg(raw);
    const w = img.naturalWidth || 1500, h = img.naturalHeight || 1500;
    const k = 2400 / Math.max(w, h);
    return drawToPng(img, Math.round(w * k), Math.round(h * k));
  }
  const img = await loadImg(raw);
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (k >= 1 && file.size < 9_000_000) return raw;
  return drawToPng(img, Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
}
function loadImg(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Couldn't read that image"));
    i.src = src;
  });
}
function drawToPng(img: HTMLImageElement, w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/png");
}

const PLACEMENTS = [
  { id: "full-front", label: "Front center" },
  { id: "left-chest", label: "Left chest" },
  { id: "back", label: "Back" },
];

export default function MockupStudio({ apiBase = "", mode = "public" }: { apiBase?: string; mode?: "admin" | "public" }) {
  const maxGarments = mode === "admin" ? 8 : 4;
  const [logo, setLogo] = useState<string | null>(null);
  const [logoName, setLogoName] = useState("");
  const [tab, setTab] = useState<"catalog" | "upload">("catalog");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [product, setProduct] = useState<(Product & { source: "sanmar" | "ss" }) | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [placement, setPlacement] = useState("full-front");
  const [decoration, setDecoration] = useState("print");
  const [sizePct, setSizePct] = useState(100);
  const [autoAdjust, setAutoAdjust] = useState(true);
  const [request, setRequest] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = (p: string) => (p.startsWith("/") ? apiBase + p : p);

  function onSearch(v: string) {
    setQ(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (v.trim().length < 2) return setHits([]);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(url(`/api/mockup-studio/search?q=${encodeURIComponent(v.trim())}`));
        setHits((await r.json()).results ?? []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  async function openStyle(h: SearchHit) {
    setError("");
    setHits([]);
    setQ(`${h.styleNumber} — ${h.brand} ${h.name}`);
    const r = await fetch(url(`/api/mockup-studio/product?style=${encodeURIComponent(h.styleNumber)}&source=${h.source}`));
    const d = await r.json();
    if (!r.ok) return setError(d.error || "Couldn't load that style");
    setProduct({ ...d.product, source: h.source });
  }

  function toggleColor(c: Product["colors"][number]) {
    if (!product) return;
    const label = `${product.styleNumber} ${c.name}`;
    setPicked((prev) => {
      if (prev.some((p) => p.label === label)) return prev.filter((p) => p.label !== label);
      if (prev.length >= maxGarments) {
        setError(`Up to ${maxGarments} garments at a time.`);
        return prev;
      }
      setError("");
      return [...prev, { kind: "catalog", source: product.source, style: product.styleNumber, color: c.name, hex: c.hexes[0], label }];
    });
  }

  async function addUploads(files: FileList | null) {
    if (!files) return;
    const room = maxGarments - picked.length;
    const list = [...files].slice(0, Math.max(0, room));
    const added: Picked[] = [];
    for (const f of list) added.push({ kind: "upload", data: await fileToDataUrl(f, 2400), label: f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 40) || "My garment" });
    setPicked((p) => [...p, ...added]);
  }

  async function generate(revise = false) {
    if (!logo) return setError("Upload a logo first.");
    if (!picked.length) return setError("Pick at least one garment.");
    setBusy(true);
    setError("");
    try {
      const body = {
        logo,
        garments: picked.map((p) => (p.kind === "catalog" ? { source: p.source, style: p.style, color: p.color, label: p.label } : { upload: p.data, label: p.label })),
        placement,
        decoration,
        sizePct,
        autoAdjust,
        request: request.trim() || undefined,
        ...(revise && result ? { plan: result.plan, feedback: feedback.trim() } : {}),
      };
      const r = await fetch(url("/api/mockup-studio/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: mode === "admin" ? "include" : "omit",
      });
      const d = await r.json().catch(() => ({ error: "Something went wrong." }));
      if (!r.ok) throw new Error(d.error || "Something went wrong.");
      setResult(d);
      if (revise) setFeedback("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const baseName = useMemo(() => (logoName || "logo").replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40), [logoName]);
  const card = "rounded-2xl border border-slate-200 bg-white p-4 sm:p-5";
  const label = "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2";

  return (
    <div className="space-y-5 text-slate-800">
      {/* 1. Logo */}
      <section className={card}>
        <span className={label}>1. Your logo</span>
        <label
          className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border-2 border-dashed border-slate-300 p-4 cursor-pointer hover:border-slate-400"
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) {
              setLogo(await fileToDataUrl(f));
              setLogoName(f.name);
              setResult(null);
            }
          }}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="Your logo" className="h-24 w-24 object-contain rounded-lg bg-[conic-gradient(#e5e7eb_25%,#fff_0_50%,#e5e7eb_0_75%,#fff_0)] bg-[length:16px_16px]" />
          ) : (
            <div className="h-24 w-24 rounded-lg bg-slate-100 grid place-items-center text-3xl text-slate-400">+</div>
          )}
          <div className="text-sm text-center sm:text-left">
            <p className="font-semibold">{logo ? logoName : "Upload or drop your logo"}</p>
            <p className="text-slate-500">PNG with a transparent background works best. JPG, WEBP and SVG are fine too.</p>
          </div>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setLogo(await fileToDataUrl(f));
                setLogoName(f.name);
                setResult(null);
              }
            }}
          />
        </label>
      </section>

      {/* 2. Garments */}
      <section className={card}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className={label + " mb-0"}>2. Garments ({picked.length}/{maxGarments})</span>
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
            {(["catalog", "upload"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 rounded-md ${tab === t ? "bg-white shadow-sm font-semibold" : "text-slate-600"}`}>
                {t === "catalog" ? "Pick a blank" : "Upload a photo"}
              </button>
            ))}
          </div>
        </div>

        {tab === "catalog" ? (
          <div>
            <div className="relative">
              <input
                value={q}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search a style: 8000, PC54, Bella 3001, hoodie…"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              {searching && <span className="absolute right-3 top-2.5 text-xs text-slate-400">Searching…</span>}
              {hits.length > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {hits.map((h) => (
                    <button key={h.source + h.styleNumber} onClick={() => openStyle(h)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                      {h.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url(h.image)} alt="" className="h-9 w-9 object-contain" />
                      ) : (
                        <span className="h-9 w-9" />
                      )}
                      <span className="flex-1 min-w-0 truncate">
                        <b>{h.styleNumber}</b> {h.brand} {h.name}
                      </span>
                      <span className="text-[10px] uppercase text-slate-400">{h.source === "ss" ? "S&S" : "SanMar"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {product && (
              <div className="mt-3">
                <p className="text-sm text-slate-600 mb-2">
                  <b>{product.styleNumber}</b> {product.name} — tap colors to add them
                </p>
                <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto">
                  {product.colors.map((c) => {
                    const on = picked.some((p) => p.label === `${product.styleNumber} ${c.name}`);
                    return (
                      <button
                        key={c.name}
                        onClick={() => toggleColor(c)}
                        title={c.name}
                        className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 hover:border-slate-500"}`}
                      >
                        <span className="h-4 w-4 rounded-full border border-black/10" style={{ background: c.hexes[0] || "#ccc" }} />
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <label className="block rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm text-center cursor-pointer hover:border-slate-400">
            Upload photos of blank garments (flat, front facing, plain background works best)
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => addUploads(e.target.files)} />
          </label>
        )}

        {picked.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {picked.map((p, i) => (
              <span key={p.label + i} className="flex items-center gap-1.5 rounded-full bg-slate-100 pl-2 pr-1 py-1 text-xs">
                {p.kind === "catalog" ? (
                  <span className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ background: p.hex || "#ccc" }} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.data} alt="" className="h-5 w-5 rounded object-cover" />
                )}
                {p.kind === "upload" ? (
                  <input
                    value={p.label}
                    onChange={(e) => setPicked((prev) => prev.map((x, k) => (k === i ? { ...x, label: e.target.value.slice(0, 40) } : x)))}
                    className="w-28 bg-transparent"
                  />
                ) : (
                  p.label
                )}
                <button onClick={() => setPicked((prev) => prev.filter((_, k) => k !== i))} className="ml-0.5 h-5 w-5 rounded-full hover:bg-slate-200" aria-label={`Remove ${p.label}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 3. Options */}
      <section className={card}>
        <span className={label}>3. Placement and changes</span>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Placement
            <select value={placement} onChange={(e) => setPlacement(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm">
              {PLACEMENTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Decoration
            <select value={decoration} onChange={(e) => setDecoration(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm">
              <option value="print">Print</option>
              <option value="embroidery">Embroidery</option>
            </select>
          </label>
          <label className="text-sm">
            Size: {sizePct}%
            <input type="range" min={50} max={120} step={5} value={sizePct} onChange={(e) => setSizePct(Number(e.target.value))} className="mt-3 w-full" />
          </label>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={autoAdjust} onChange={(e) => setAutoAdjust(e.target.checked)} className="mt-0.5" />
          <span>
            <b>Fix contrast for each color automatically</b>
            <span className="block text-slate-500">e.g. dark text turns white on a black shirt, or a gold border gets an outline on a gold shirt.</span>
          </span>
        </label>
        <label className="mt-3 block text-sm">
          Changes you want (optional)
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={2}
            placeholder={'e.g. "On the black shirt make the bottom text white" or "Add a navy outline on the yellow one"'}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          onClick={() => generate(false)}
          disabled={busy}
          className="mt-4 w-full sm:w-auto rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Making mockups… (up to a minute)" : "Make mockups"}
        </button>
      </section>

      {/* Results */}
      {result && (
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <span className={label + " mb-0"}>Your mockups</span>
            {result.sheet && (
              <a href={`data:image/jpeg;base64,${result.sheet}`} download={`${baseName}-mockups-all.jpg`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                Download all-in-one
              </a>
            )}
          </div>
          {result.summary && <p className="mb-3 text-sm text-slate-600">{result.summary}</p>}
          {result.logoNote && <p className="mb-3 text-xs text-amber-700">{result.logoNote}</p>}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((it) => (
              <figure key={it.label} className="rounded-xl border border-slate-200 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:image/jpeg;base64,${it.jpg}`} alt={`${it.label} mockup`} className="w-full aspect-square object-contain bg-white" />
                <figcaption className="p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <b className="truncate">{it.label}</b>
                    <a href={`data:image/jpeg;base64,${it.jpg}`} download={`${baseName}-${it.label.replace(/[^A-Za-z0-9]+/g, "-")}.jpg`} className="shrink-0 text-xs font-semibold text-slate-700 underline">
                      Download
                    </a>
                  </div>
                  {it.note && <p className="mt-1 text-xs text-slate-500">{it.note}</p>}
                  {it.warning && <p className="mt-1 text-xs text-amber-700">{it.warning}</p>}
                  {mode === "admin" && it.ops.length > 0 && (
                    <details className="mt-1 text-[11px] text-slate-400">
                      <summary className="cursor-pointer">Edits</summary>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(it.ops, null, 1)}</pre>
                    </details>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="mt-5 border-t border-slate-200 pt-4">
            <label className="block text-sm font-semibold">Want something changed?</label>
            <div className="mt-1 flex flex-col sm:flex-row gap-2">
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && feedback.trim() && !busy && generate(true)}
                placeholder={'e.g. "Make the outline on the yellow shirt thicker"'}
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                onClick={() => generate(true)}
                disabled={busy || !feedback.trim()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Updating…" : "Update"}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
