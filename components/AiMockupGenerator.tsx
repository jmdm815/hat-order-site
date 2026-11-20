"use client";

// AI product mockup generator UI (admin "AI Blanks" tab, and a modal inside
// the Garment Mockup tool). Upload product photos → analyze → generate the
// primary view → generate the remaining views from the photos + approved
// primary → QC each view. Every view can be regenerated, refined with an
// instruction, approved, downloaded, or zipped. All images stay in the
// browser; nothing is stored server-side. See lib/ai-mockup.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { makeZip } from "@/lib/zip";
import type {
  MockupBackground,
  MockupModel,
  MockupQuality,
  MockupStyle,
  ProductDescription,
  QcResult,
  ViewDef,
} from "@/lib/ai-mockup";

type Ref = { id: string; name: string; url: string; blob: Blob };
type ViewState = {
  view: ViewDef;
  status: "queued" | "generating" | "done" | "error";
  url?: string; // object URL of the PNG
  blob?: Blob;
  error?: string;
  approved?: boolean;
  inferred?: boolean;
  qc?: QcResult | "checking";
  model?: string;
  refineOpen?: boolean;
  refineText?: string;
};

export type GeneratedViews = { id: string; label: string; url: string; blob: Blob }[];

const APPAREL: ViewDef[] = [
  { id: "front", label: "Front" },
  { id: "back", label: "Back" },
  { id: "left-side", label: "Left Side" },
  { id: "right-side", label: "Right Side" },
];
const PRODUCT_TYPES = ["T-shirt", "Polo", "Hoodie", "Crewneck sweatshirt", "Jacket", "Long sleeve tee", "Hat / cap", "Beanie", "Tote bag", "Backpack", "Other"];
const MAX_REFS = 6;
const MAX_UPLOAD = 15 * 1024 * 1024;

const card = "rounded-2xl border border-admin-ink/20 bg-admin-card p-4 sm:p-5";
const stepTitle = "font-heading text-base font-semibold uppercase tracking-wide";
const btn = "rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed";
const btnPrimary = `${btn} bg-admin-accent text-admin-accent-ink hover:bg-admin-accent-dim`;
const btnGhost = `${btn} border border-admin-ink/30 hover:bg-admin-ink/10`;
const btnSm = "rounded-lg border border-admin-ink/25 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-admin-ink/5 disabled:opacity-50";

const uid = () => Math.random().toString(36).slice(2, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "product";

// Downscale to ≤1536px JPEG so several refs fit in one request.
async function toRefJpeg(src: Blob, maxSide = 1536, quality = 0.9): Promise<Blob> {
  const url = URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read image"))), "image/jpeg", quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const b64ToBlob = (b64: string, type = "image/png") => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
};

async function postForm<T>(url: string, form: FormData, tries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "POST", body: form });
    const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
    if (res.ok) return data as T;
    if (res.status === 429 && attempt < tries) {
      await new Promise((r) => setTimeout(r, Math.min(30, Number(data.retryAfter) || 15) * 1000));
      continue;
    }
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
}

export default function AiMockupGenerator({
  initialImages,
  onUseViews,
  useLabel = "Use as blank photos",
}: {
  initialImages?: { url: string; name: string }[];
  onUseViews?: (views: GeneratedViews) => void;
  useLabel?: string;
}) {
  const [refs, setRefs] = useState<Ref[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [productType, setProductType] = useState("auto");
  const [style, setStyle] = useState<MockupStyle>("technical-flat");
  const [background, setBackground] = useState<MockupBackground>("white");
  const [quality, setQuality] = useState<MockupQuality>("high");
  const [model, setModel] = useState<MockupModel>("sunburst");
  const [preserveBranding, setPreserveBranding] = useState(true);
  const [wantViews, setWantViews] = useState<string[]>(APPAREL.map((v) => v.id));
  const [description, setDescription] = useState<ProductDescription | null>(null);
  const [views, setViews] = useState<ViewState[]>([]);
  const [phase, setPhase] = useState<"idle" | "analyzing" | "generating" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ViewState | null>(null);
  const [zipping, setZipping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewsRef = useRef<ViewState[]>([]);
  useEffect(() => {
    viewsRef.current = views;
  }, [views]);

  // Seed from images handed in by the Garment Mockup tool.
  useEffect(() => {
    if (!initialImages?.length) return;
    let cancelled = false;
    (async () => {
      const out: Ref[] = [];
      for (const im of initialImages.slice(0, MAX_REFS)) {
        try {
          const blob = await toRefJpeg(await (await fetch(im.url)).blob());
          out.push({ id: uid(), name: im.name, url: URL.createObjectURL(blob), blob });
        } catch {
          /* skip unreadable */
        }
      }
      if (!cancelled) setRefs(out);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Free object URLs on unmount.
  useEffect(
    () => () => {
      viewsRef.current.forEach((v) => v.url && URL.revokeObjectURL(v.url));
    },
    [],
  );

  async function addFiles(files: FileList | File[]) {
    setError(null);
    const list = Array.from(files);
    const room = MAX_REFS - refs.length;
    const added: Ref[] = [];
    for (const f of list.slice(0, Math.max(0, room))) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
        setError(`${f.name}: use JPG, PNG or WebP.`);
        continue;
      }
      if (f.size > MAX_UPLOAD) {
        setError(`${f.name} is over 15 MB.`);
        continue;
      }
      try {
        const blob = await toRefJpeg(f);
        added.push({ id: uid(), name: f.name, url: URL.createObjectURL(blob), blob });
      } catch {
        setError(`Couldn't read ${f.name}.`);
      }
    }
    if (list.length > room) setError(`Up to ${MAX_REFS} photos.`);
    setRefs((prev) => [...prev, ...added]);
  }

  function removeRef(id: string) {
    setRefs((prev) => {
      const r = prev.find((x) => x.id === id);
      if (r) URL.revokeObjectURL(r.url);
      return prev.filter((x) => x.id !== id);
    });
  }

  const patchView = useCallback((id: string, patch: Partial<ViewState>) => {
    setViews((prev) => prev.map((v) => (v.view.id === id ? { ...v, ...patch } : v)));
  }, []);

  function specFor(d: ProductDescription, view: ViewDef, instruction?: string) {
    return { description: d, view, style, background, quality, model, preserveBranding, instruction };
  }

  async function runQc(d: ProductDescription, view: ViewDef, blob: Blob) {
    patchView(view.id, { qc: "checking" });
    try {
      const f = new FormData();
      f.append("spec", JSON.stringify(specFor(d, view)));
      refs.forEach((r, i) => f.append("refs", r.blob, `ref-${i}.jpg`));
      f.append("output", await toRefJpeg(blob, 1024, 0.85), "output.jpg");
      const { qc } = await postForm<{ qc: QcResult }>("/api/admin/ai-mockup/check", f, 1);
      patchView(view.id, { qc });
    } catch {
      patchView(view.id, { qc: undefined });
    }
  }

  // Generate (or regenerate / refine) one view.
  async function genView(d: ProductDescription, view: ViewDef, opts: { primary?: Blob; current?: Blob; instruction?: string } = {}) {
    patchView(view.id, { status: "generating", error: undefined, qc: undefined });
    try {
      const f = new FormData();
      f.append("spec", JSON.stringify(specFor(d, view, opts.instruction)));
      refs.forEach((r, i) => f.append("refs", r.blob, `ref-${i}.jpg`));
      if (opts.current) f.append("current", await toRefJpeg(opts.current, 1536, 0.92), "current.jpg");
      else if (opts.primary) f.append("primary", await toRefJpeg(opts.primary, 1536, 0.92), "primary.jpg");
      const r = await postForm<{ image: string; model: string }>("/api/admin/ai-mockup/generate", f);
      const blob = b64ToBlob(r.image);
      const url = URL.createObjectURL(blob);
      setViews((prev) =>
        prev.map((v) => {
          if (v.view.id !== view.id) return v;
          if (v.url) URL.revokeObjectURL(v.url);
          return { ...v, status: "done", url, blob, model: r.model, approved: false, refineOpen: false, refineText: "" };
        }),
      );
      void runQc(d, view, blob);
      return blob;
    } catch (e) {
      patchView(view.id, { status: "error", error: (e as Error).message });
      return null;
    }
  }

  async function generateAll() {
    if (!refs.length) return setError("Add at least one product photo.");
    setError(null);
    setPhase("analyzing");
    views.forEach((v) => v.url && URL.revokeObjectURL(v.url));
    setViews([]);
    let d: ProductDescription;
    try {
      const f = new FormData();
      refs.forEach((r, i) => f.append("refs", r.blob, `ref-${i}.jpg`));
      if (productType !== "auto") f.append("hint", productType);
      d = (await postForm<{ description: ProductDescription }>("/api/admin/ai-mockup/analyze", f)).description;
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
      return;
    }
    setDescription(d);
    const isApparel = d.category === "apparel_top" || d.category === "apparel_bottom";
    const list = isApparel ? APPAREL.filter((v) => wantViews.includes(v.id)) : d.suggestedViews.slice(0, 4);
    if (!list.length) {
      setError("Pick at least one view.");
      setPhase("idle");
      return;
    }
    setViews(list.map((v) => ({ view: v, status: "queued", inferred: !d.visibleViews.includes(v.id) })));
    setPhase("generating");
    // Primary first, then the rest two at a time with the primary attached.
    const [primary, ...rest] = list;
    const pBlob = await genView(d, primary);
    const queue = [...rest];
    const worker = async () => {
      while (queue.length) {
        const v = queue.shift()!;
        await genView(d, v, { primary: pBlob ?? undefined });
      }
    };
    await Promise.all([worker(), worker()]);
    setPhase("done");
  }

  function primaryBlob(): Blob | undefined {
    const p = viewsRef.current[0];
    return p?.status === "done" ? p.blob : undefined;
  }

  function regenerate(v: ViewState) {
    if (!description) return;
    const isPrimary = viewsRef.current[0]?.view.id === v.view.id;
    void genView(description, v.view, { primary: isPrimary ? undefined : primaryBlob() });
  }

  function refine(v: ViewState) {
    if (!description || !v.blob || !v.refineText?.trim()) return;
    void genView(description, v.view, { current: v.blob, instruction: v.refineText.trim() });
  }

  const fileName = (v: ViewState) => `${slug(description?.productType ?? "product")}-${v.view.id}.png`;
  const done = views.filter((v) => v.status === "done" && v.blob);

  async function downloadZip() {
    setZipping(true);
    try {
      const zip = await makeZip(done.map((v) => ({ name: fileName(v), blob: v.blob! })));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zip);
      a.download = `${slug(description?.productType ?? "product")}-mockups.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } finally {
      setZipping(false);
    }
  }

  const busy = phase === "analyzing" || views.some((v) => v.status === "generating");
  const isApparelChoice = !description || description.category === "apparel_top" || description.category === "apparel_bottom";

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* 1 · Photos + settings */}
        <div className="space-y-5">
          <section className={card}>
            <h3 className={stepTitle}>1 · Product photos</h3>
            <p className="mt-1 text-xs text-admin-ink/65">A model wearing it, a hanger shot, an angle, a catalog photo — add front and back if you have them.</p>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInput.current?.click()}
              className={`mt-3 cursor-pointer rounded-xl border-2 border-dashed p-5 text-center text-sm transition ${
                dragOver ? "border-admin-accent bg-admin-accent/5" : "border-admin-ink/25 hover:bg-admin-ink/5"
              }`}
            >
              Drop photos here or <span className="font-semibold underline">choose files</span>
              <span className="block text-xs text-admin-ink/55 mt-1">JPG, PNG or WebP · up to {MAX_REFS} · 15 MB each</span>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {refs.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {refs.map((r) => (
                  <div key={r.id} className="relative rounded-lg border border-admin-ink/15 bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt={r.name} className="h-24 w-full object-contain" />
                    <button
                      type="button"
                      onClick={() => removeRef(r.id)}
                      className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full bg-white border border-admin-ink/25 text-xs font-bold hover:bg-red-50"
                      aria-label={`Remove ${r.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={card}>
            <h3 className={stepTitle}>2 · Settings</h3>
            <div className="mt-3 grid gap-3 text-sm">
              <label className="block">
                <span className="block text-xs font-medium text-admin-ink/70 mb-1">Product type</span>
                <select className="w-full rounded-xl border border-admin-ink/25 bg-white px-3 py-2" value={productType} onChange={(e) => setProductType(e.target.value)}>
                  <option value="auto">Auto detect</option>
                  {PRODUCT_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <Seg label="Style" value={style} onChange={setStyle} options={[["technical-flat", "Technical flat"], ["studio", "Studio product"]]} />
              <Seg label="Background" value={background} onChange={setBackground} options={[["white", "White"], ["light-gray", "Light gray"], ["transparent", "Transparent"]]} />
              <Seg label="Quality" value={quality} onChange={setQuality} options={[["standard", "Standard"], ["high", "High"]]} />
              <Seg label="Model" value={model} onChange={setModel} options={[["sunburst", "High fidelity"], ["flare", "Faster"]]} />
              {isApparelChoice && (
                <div>
                  <span className="block text-xs font-medium text-admin-ink/70 mb-1">Views (apparel)</span>
                  <div className="flex flex-wrap gap-3">
                    {APPAREL.map((v) => (
                      <label key={v.id} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={wantViews.includes(v.id)}
                          onChange={(e) => setWantViews((p) => (e.target.checked ? [...p, v.id] : p.filter((x) => x !== v.id)))}
                        />
                        {v.label}
                      </label>
                    ))}
                  </div>
                  <span className="block text-[11px] text-admin-ink/50 mt-1">Other products get the best views for their shape automatically.</span>
                </div>
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={preserveBranding} onChange={(e) => setPreserveBranding(e.target.checked)} />
                Preserve existing branding
                <span className="text-xs text-admin-ink/50">(off = blank garment)</span>
              </label>
            </div>
            <button type="button" className={`${btnPrimary} mt-4 w-full`} disabled={busy || !refs.length} onClick={generateAll}>
              {phase === "analyzing" ? "Analyzing photos…" : busy ? "Generating…" : views.length ? "Generate again" : "Generate mockups"}
            </button>
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          </section>
        </div>

        {/* 3 · Results */}
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={stepTitle}>3 · Mockups</h3>
            <div className="flex flex-wrap gap-2">
              {onUseViews && done.length > 0 && (
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => onUseViews(done.map((v) => ({ id: v.view.id, label: v.view.label, url: v.url!, blob: v.blob! })))}>
                  {useLabel}
                </button>
              )}
              {done.length > 1 && (
                <button type="button" className={btnGhost} disabled={zipping} onClick={downloadZip}>
                  {zipping ? "Zipping…" : `Download all (${done.length}) .zip`}
                </button>
              )}
            </div>
          </div>

          {description && (
            <details className="mt-3 rounded-xl bg-admin-ink/[0.04] p-3 text-xs">
              <summary className="cursor-pointer font-semibold">
                Detected: {description.productType} · {description.color}
                {description.decorations.length ? ` · ${description.decorations.length} decoration${description.decorations.length > 1 ? "s" : ""}` : " · no decorations"}
              </summary>
              <ul className="mt-2 space-y-1 text-admin-ink/80">
                <li>
                  <b>Construction:</b> {description.construction.join(", ") || "—"}
                </li>
                {description.decorations.map((x, i) => (
                  <li key={i}>
                    <b>{x.location}:</b> {x.description} ({x.colors}, {x.approxSize})
                  </li>
                ))}
                <li>
                  <b>Photos show:</b> {description.visibleViews.join(", ") || "—"}
                </li>
              </ul>
              {description.smallTextNeedsReview && <p className="mt-2 text-amber-800">Small lettering detected — AI may not reproduce it exactly. Review before using.</p>}
            </details>
          )}

          {!views.length ? (
            <div className="mt-4 flex min-h-64 items-center justify-center rounded-xl border border-dashed border-admin-ink/20 text-sm text-admin-ink/55">
              {phase === "analyzing" ? "Reading the product…" : "Your mockups will appear here."}
            </div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {views.map((v) => (
                <div key={v.view.id} className={`rounded-xl border p-3 ${v.approved ? "border-green-600 ring-1 ring-green-600" : "border-admin-ink/15"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">
                      {v.view.label}
                      {v.inferred && <span className="ml-1.5 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-semibold align-middle">AI-inferred view</span>}
                    </span>
                    {v.status === "done" && (
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={!!v.approved} onChange={(e) => patchView(v.view.id, { approved: e.target.checked })} />
                        Approved
                      </label>
                    )}
                  </div>
                  <div
                    className={`mt-2 flex aspect-[2/3] items-center justify-center overflow-hidden rounded-lg ${
                      background === "transparent" ? "bg-[length:16px_16px] bg-[conic-gradient(#eee_25%,#fff_0_50%,#eee_0_75%,#fff_0)]" : "bg-white"
                    } border border-admin-ink/10`}
                  >
                    {v.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.url} alt={v.view.label} onClick={() => setZoom(v)} className={`h-full w-full cursor-zoom-in object-contain ${v.status === "generating" ? "opacity-40" : ""}`} />
                    ) : (
                      <span className="text-xs text-admin-ink/55 px-4 text-center">
                        {v.status === "queued" ? "Waiting…" : v.status === "generating" ? "Generating… (about 20–60 s)" : v.error}
                      </span>
                    )}
                  </div>
                  {v.status === "generating" && v.url && <p className="mt-1 text-xs text-admin-ink/60">Updating…</p>}
                  {v.status === "error" && v.url && <p className="mt-1 text-xs text-red-700">{v.error}</p>}

                  {v.qc === "checking" && <p className="mt-2 text-xs text-admin-ink/55">Checking quality…</p>}
                  {v.qc && v.qc !== "checking" && (
                    <div className={`mt-2 rounded-lg px-2 py-1.5 text-xs ${v.qc.needsReview ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-900"}`}>
                      {v.qc.needsReview ? "Needs review: " : "Checks passed"}
                      {v.qc.checks
                        .filter((c) => !c.ok)
                        .map((c) => `${c.label} — ${c.note}`)
                        .join(" · ")}
                      {v.qc.needsReview && v.qc.checks.every((c) => c.ok) && "small lettering may not be exact"}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {v.status === "done" && v.url && (
                      <a className={btnSm} href={v.url} download={fileName(v)}>
                        Download PNG
                      </a>
                    )}
                    <button type="button" className={btnSm} disabled={v.status === "generating" || !description} onClick={() => regenerate(v)}>
                      {v.status === "error" ? "Retry" : "Regenerate"}
                    </button>
                    {v.status === "done" && (
                      <button type="button" className={btnSm} onClick={() => patchView(v.view.id, { refineOpen: !v.refineOpen })}>
                        Refine…
                      </button>
                    )}
                  </div>
                  {v.refineOpen && (
                    <div className="mt-2 space-y-1.5">
                      <textarea
                        className="w-full rounded-lg border border-admin-ink/25 px-2 py-1.5 text-sm"
                        rows={2}
                        placeholder="e.g. Make the sleeves straighter · Remove the wrinkles · Keep the logo exactly where it was"
                        value={v.refineText ?? ""}
                        onChange={(e) => patchView(v.view.id, { refineText: e.target.value })}
                      />
                      <button type="button" className={btnSm} disabled={!v.refineText?.trim()} onClick={() => refine(v)}>
                        Apply to this view
                      </button>
                    </div>
                  )}
                  {v.model && <p className="mt-1 text-[10px] text-admin-ink/40">{v.model}</p>}
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-[11px] text-admin-ink/50">
            AI-rendered logos and lettering are previews, not production artwork. Check small text before sending to a customer.
          </p>
        </section>
      </div>

      {zoom?.url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.url} alt={zoom.view.label} className="max-h-full max-w-full rounded-lg bg-white" />
        </div>
      )}
    </div>
  );
}

function Seg<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div>
      <span className="block text-xs font-medium text-admin-ink/70 mb-1">{label}</span>
      <div className="inline-flex flex-wrap rounded-xl border border-admin-ink/25 p-1">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold ${value === v ? "bg-admin-accent text-admin-accent-ink" : "hover:bg-admin-ink/5"}`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
