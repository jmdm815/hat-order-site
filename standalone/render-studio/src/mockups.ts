// Mockup renderer: logo + catalog garments (SanMar / S&S) or your own photos
// -> full-resolution mockup JPGs saved to ~/Documents/JM Renders/Mockups.
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  detectGarmentBounds, onModelGarmentBounds, layoutForPreset, renderMockup, combineGrid, presetsFor,
  trimTransparent, type PlacementPreset, type LogoLayout,
} from "../../../lib/garment-mockup";
import { aiDraw, forgetKey, saveKey, savedKeyHint } from "./ai-draw";
import { analyzeImg, applyEditsImg, sanitizeOps, type EditOp, type Img } from "../../../lib/logo-edit-core";
import { API, D, download, getJson, notify, openFolder, readBytes, root, safeName, stamp, writeBig } from "./desktop";
import { busy, canvasBlob, canvasBytes, errMsg, field, fileToImage, h, range, toast } from "./ui";

type Color = { name: string; hexes: string[]; photo: string; back?: string; local?: HTMLImageElement; localBack?: HTMLImageElement };
type Product = { styleNumber: string; name: string; hat: boolean; colors: Color[] };

const S = {
  logoSrc: null as HTMLImageElement | null,
  logo: null as HTMLCanvasElement | null, // after cutout + trim
  cutout: true, tol: 28, holes: false,
  source: "sanmar" as "sanmar" | "ss" | "upload",
  product: null as Product | null,
  picked: new Set<string>(),
  uploads: [] as Color[],
  placement: "full-front",
  // Fabric show-through and raised look are hidden for now (kept off).
  sizePct: 100, offsetX: 0, offsetY: 0, blend: 0, raised: false, onModel: false,
  view: "exact" as "exact" | "ai",
  ai: new Map<string, HTMLCanvasElement>(), // AI drawn version, by colour name
  edits: {} as Record<string, EditOp[]>, // by color name ("*" = all)
  photos: new Map<string, HTMLImageElement>(),
  job: "",
};

// ------------------------------------------------------------ logo cutout
function imgData(src: CanvasImageSource, w: number, h: number): ImageData {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(src, 0, 0, w, h);
  return x.getImageData(0, 0, w, h);
}

/** Remove a flat background: flood from the edges (and, optionally, every
 *  matching pixel inside letters/enclosed areas). */
export function cutout(img: HTMLImageElement, tol: number, holes: boolean): HTMLCanvasElement {
  const W = img.naturalWidth, H = img.naturalHeight;
  const id = imgData(img, W, H);
  const d = id.data;
  // Background = most common colour on the border.
  const counts = new Map<number, number>();
  const border = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 30) return;
    const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  for (let x = 0; x < W; x++) { border(x, 0); border(x, H - 1); }
  for (let y = 0; y < H; y++) { border(0, y); border(W - 1, y); }
  if (!counts.size) return trimTransparent(img); // already transparent
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bg = [((top >> 10) & 31) * 8 + 4, ((top >> 5) & 31) * 8 + 4, (top & 31) * 8 + 4];
  const dist = (i: number) => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
  const T = tol * 3, soft = T * 1.7;
  const mark = new Uint8Array(W * H);
  if (holes) {
    for (let p = 0; p < W * H; p++) if (dist(p * 4) <= T) mark[p] = 1;
  } else {
    const stack: number[] = [];
    const push = (p: number) => { if (!mark[p] && dist(p * 4) <= T) { mark[p] = 1; stack.push(p); } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      if (x > 0) push(p - 1);
      if (x < W - 1) push(p + 1);
      if (y > 0) push(p - W);
      if (y < H - 1) push(p + W);
    }
  }
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (mark[p]) { d[i + 3] = 0; continue; }
    // Soften the fringe next to removed pixels.
    const x = p % W, y = (p / W) | 0;
    const near = (x > 0 && mark[p - 1]) || (x < W - 1 && mark[p + 1]) || (y > 0 && mark[p - W]) || (y < H - 1 && mark[p + W]);
    if (near) {
      const k = dist(i);
      if (k < soft) d[i + 3] = Math.round(d[i + 3] * Math.max(0, (k - T) / (soft - T)));
    }
  }
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  c.getContext("2d")!.putImageData(id, 0, 0);
  return trimCanvas(c);
}

function trimCanvas(c: HTMLCanvasElement): HTMLCanvasElement {
  const { width: W, height: H } = c;
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return c;
  const o = document.createElement("canvas");
  o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d")!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

const toImg = (c: HTMLCanvasElement): Img => ({ d: c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height });
function fromImg(im: Img): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = im.w; c.height = im.h;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(im.d), im.w, im.h), 0, 0);
  return c;
}

function logoFor(color: string): HTMLCanvasElement {
  const ops = [...(S.edits["*"] ?? []), ...(S.edits[color] ?? [])];
  if (!ops.length || !S.logo) return S.logo!;
  return fromImg(applyEditsImg(toImg(S.logo), ops));
}

// ------------------------------------------------------------ garment photos
async function photo(url: string): Promise<HTMLImageElement> {
  const hit = S.photos.get(url);
  if (hit) return hit;
  const cache = await root(".cache");
  let n = 0;
  for (const ch of url) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  const path = `${cache}/${n.toString(36)}.jpg`;
  if (!(await D.fs.exists(path))) await download(url.startsWith("http") ? url : API + url, path);
  const img = await fileToImage(new Blob([(await readBytes(path)) as BlobPart]));
  S.photos.set(url, img);
  return img;
}

function chosenColors(): Color[] {
  if (S.source === "upload") return S.uploads;
  return (S.product?.colors ?? []).filter((c) => S.picked.has(c.name));
}

function preset(): PlacementPreset {
  const list = presetsFor(S.product?.hat ? "hat" : "shirt");
  return list.find((p) => p.id === S.placement) ?? list[0];
}

type Shot = { canvas: HTMLCanvasElement; L: LogoLayout; k: number; gw: number; gh: number; logo: HTMLCanvasElement };

async function renderOne(c: Color): Promise<Shot> {
  const p = preset();
  const back = p.view === "back";
  const base = c.local ? (back && c.localBack ? c.localBack : c.local) : await photo(back && c.back ? c.back : c.photo);
  let g = detectGarmentBounds(base);
  if (S.onModel) g = onModelGarmentBounds(g);
  const logo = logoFor(c.name);
  const L = layoutForPreset(p, g, logo.width, logo.height, S.sizePct);
  L.x += (g.width * S.offsetX) / 100;
  L.y += (g.height * S.offsetY) / 100;
  const canvas = renderMockup(base, logo, L, { fabricBlend: S.blend, raised: S.raised });
  return { canvas, L, k: canvas.width / base.naturalWidth, gw: g.width, gh: g.height, logo };
}

function garmentName(c: Color) {
  return S.source === "upload" ? `garment in ${c.name}` : `${S.product?.name ?? S.product?.styleNumber ?? "garment"} in ${c.name}`;
}

// ------------------------------------------------------------ Claude auto-fix
async function claudeFix(instructions: string, colors: Color[]) {
  const sample = await (window as any).claude?.use?.("sample");
  if (!sample) throw new Error("Claude isn't available in this view.");
  const a = analyzeImg(toImg(S.logo!));
  const palette = a.palette.slice(0, 10).map((p) => ({ hex: p.hex, coverage: Math.round(p.coverage * 1000) / 10, box: p.box }));
  const prompt = `You prepare a customer logo for garment mockups. The logo image (${a.w}x${a.h}px, transparent background) is attached.
Its colour palette (coverage %, bounding box in px): ${JSON.stringify(palette)}
Garment colours to mock up: ${JSON.stringify(colors.map((c) => ({ name: c.name, hex: c.hexes[0] ?? "" })))}
Instructions from the decorator: ${instructions || "Make the logo read clearly on every garment colour. On dark garments, change black/dark navy parts to white. On light garments, keep it as is. Add a thin outline only where a colour nearly matches the garment."}

Edit operations you can use (all colours are hex; boxes are pixel boxes {x0,y0,x1,y1} on the logo):
- {"op":"recolor","from":"#hex from the palette","to":"#hex","tolerance":0-120 (default 40),"region":box optional - only shapes fully inside it}
- {"op":"outline","color":"#hex","width":px (1-40),"around":"logo" or a palette "#hex" to outline just that colour,"region":box optional}
- {"op":"backing","color":"#hex"}  (solid patch behind the whole logo - use rarely)
Answer ONLY JSON: {"byColor": {"<garment colour name>": [ops...]}, "note": "one short sentence on what you changed"}. Use "*" as a key for edits that apply to every colour. Use an empty list where no change is needed.`;
  const blob = await canvasBlob(S.logo!);
  const res: any = await sample.json(prompt, { images: [blob], modelTier: "default" });
  const out: Record<string, EditOp[]> = {};
  for (const [k, v] of Object.entries(res?.byColor ?? {})) out[k] = sanitizeOps(v);
  return { edits: out, note: String(res?.note ?? "") };
}

// ------------------------------------------------------------ UI
export function mockupsTab(): HTMLElement {
  const preview = h("div", { class: "grid previews" }, h("p", { class: "empty" }, "Add a logo and pick garments to see mockups here."));
  const logoBox = h("div", { class: "logo-box checker" }, h("span", { class: "empty" }, "No logo yet"));
  const resultsBox = h("div", { class: "results" });
  const colorsBox = h("div", { class: "chips" });
  const editNote = h("p", { class: "hint" });
  let timer = 0;
  let renderSeq = 0;

  const schedule = () => { clearTimeout(timer); timer = window.setTimeout(refresh, 350); };

  async function refresh() {
    const colors = chosenColors();
    if (!S.logo || !colors.length) return;
    const seq = ++renderSeq;
    viewBar.hidden = S.ai.size === 0;
    if (S.view === "ai") {
      preview.replaceChildren(...colors.map((c) => {
        const ai = S.ai.get(c.name);
        if (ai) ai.className = "shot";
        return h("figure", { class: "card", "data-c": c.name }, ai ?? h("p", { class: "empty" }, "No AI drawing yet"), h("figcaption", {}, `${c.name} · AI drawn`));
      }));
      return;
    }
    preview.replaceChildren(...colors.map((c) => h("figure", { class: "card loading", "data-c": c.name }, h("div", { class: "ph" }), h("figcaption", {}, c.name))));
    for (const c of colors) {
      try {
        const shot = await renderOne(c);
        if (seq !== renderSeq) return;
        const fig = [...preview.children].find((f) => (f as HTMLElement).dataset.c === c.name) as HTMLElement;
        const cv = shot.canvas;
        cv.className = "shot draggable";
        cv.title = "Drag the logo to move it";
        cv.addEventListener("pointerdown", (e) => startDrag(e, fig, shot));
        fig?.classList.remove("loading");
        fig?.firstElementChild?.replaceWith(cv);
      } catch (e) {
        const fig = [...preview.children].find((f) => (f as HTMLElement).dataset.c === c.name);
        fig?.firstElementChild?.replaceWith(h("p", { class: "err" }, errMsg(e)));
      }
    }
  }

  // Drag the logo on any preview; the move applies to every colour.
  function startDrag(e: PointerEvent, fig: HTMLElement, shot: Shot) {
    const cv = shot.canvas;
    const disp = cv.clientWidth / cv.width; // canvas px -> screen px
    const L = shot.L;
    const ghost = h("canvas", { class: "drag-logo" }) as HTMLCanvasElement;
    ghost.width = shot.logo.width; ghost.height = shot.logo.height;
    ghost.getContext("2d")!.drawImage(shot.logo, 0, 0);
    Object.assign(ghost.style, {
      left: `${cv.offsetLeft + L.x * shot.k * disp}px`, top: `${cv.offsetTop + L.y * shot.k * disp}px`,
      width: `${L.width * shot.k * disp}px`, height: `${L.height * shot.k * disp}px`,
    });
    fig.append(ghost);
    fig.classList.add("dragging");
    const x0 = e.clientX, y0 = e.clientY;
    cv.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => { ghost.style.transform = `translate(${ev.clientX - x0}px, ${ev.clientY - y0}px)`; };
    const up = (ev: PointerEvent) => {
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      ghost.remove();
      fig.classList.remove("dragging");
      const dx = (ev.clientX - x0) / disp / shot.k, dy = (ev.clientY - y0) / disp / shot.k; // base-photo px
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      S.offsetX = Math.round((S.offsetX + (dx / shot.gw) * 100) * 10) / 10;
      S.offsetY = Math.round((S.offsetY + (dy / shot.gh) * 100) * 10) / 10;
      offXR.set(S.offsetX); offR.set(S.offsetY);
      refresh();
    };
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
  }

  function rebuildLogo() {
    if (!S.logoSrc) return;
    S.logo = S.cutout ? cutout(S.logoSrc, S.tol, S.holes) : trimTransparent(S.logoSrc);
    S.edits = {};
    S.ai.clear(); S.view = "exact";
    editNote.textContent = "";
    const c = S.logo.cloneNode() as HTMLCanvasElement;
    c.getContext("2d")!.drawImage(S.logo, 0, 0);
    logoBox.replaceChildren(c);
    schedule();
  }

  const logoInput = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    S.logoSrc = await fileToImage(f);
    if (!S.job) { S.job = f.name.replace(/\.[^.]+$/, ""); jobInput.value = S.job; }
    rebuildLogo();
  } });

  const tolR = range(5, 80, S.tol, 1, (v) => { S.tol = v; rebuildLogo(); });
  const cutChk = h("input", { type: "checkbox", checked: S.cutout, onchange: (e: Event) => { S.cutout = (e.target as HTMLInputElement).checked; rebuildLogo(); } });
  const holeChk = h("input", { type: "checkbox", checked: S.holes, onchange: (e: Event) => { S.holes = (e.target as HTMLInputElement).checked; rebuildLogo(); } });

  // Catalog
  const q = h("input", { type: "search", placeholder: "Style # or name, e.g. 8000, PC54, 112" }) as HTMLInputElement;
  const srcSel = h("select", {}, h("option", { value: "sanmar" }, "SanMar"), h("option", { value: "ss" }, "S&S Activewear"), h("option", { value: "upload" }, "My own photos")) as HTMLSelectElement;
  const uploadInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: async (e: Event) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    for (const f of files) S.uploads.push({ name: f.name.replace(/\.[^.]+$/, ""), hexes: [], photo: "", local: await fileToImage(f) });
    renderUploads();
    schedule();
  } }) as HTMLInputElement;
  const searchRow = h("div", { class: "row" }, q, h("button", { class: "btn", onclick: () => search() }, "Search"));
  const uploadRow = h("div", { class: "row", hidden: true }, h("button", { class: "btn", onclick: () => uploadInput.click() }, "Add garment photos"), h("span", { class: "hint" }, "One photo per colour; the file name becomes the colour name."), uploadInput);

  srcSel.addEventListener("change", () => {
    S.source = srcSel.value as any;
    searchRow.hidden = S.source === "upload";
    uploadRow.hidden = S.source !== "upload";
    resultsBox.replaceChildren();
    if (S.source === "upload") renderUploads(); else renderColors();
    schedule();
  });
  q.addEventListener("keydown", (e) => e.key === "Enter" && search());

  async function search() {
    if (!q.value.trim()) return;
    resultsBox.replaceChildren(h("p", { class: "hint" }, "Searching…"));
    try {
      const r = await getJson(`${API}/api/mockup-studio/search?q=${encodeURIComponent(q.value.trim())}&source=${S.source}`);
      const list = (r.results ?? []).filter((x: any) => x.source === S.source || !x.source).slice(0, 12);
      if (!list.length) { resultsBox.replaceChildren(h("p", { class: "hint" }, "No styles found.")); return; }
      resultsBox.replaceChildren(...list.map((x: any) => h("button", { class: "result", onclick: () => pick(x.styleNumber) },
        h("b", {}, x.styleNumber), h("span", {}, x.name))));
    } catch (e) { resultsBox.replaceChildren(h("p", { class: "err" }, errMsg(e))); }
  }

  async function pick(style: string) {
    resultsBox.replaceChildren(h("p", { class: "hint" }, `Loading ${style} colours…`));
    try {
      const r = await getJson(`${API}/api/mockup-studio/product?style=${encodeURIComponent(style)}&source=${S.source}`);
      S.product = r.product;
      S.picked.clear();
      resultsBox.replaceChildren(h("p", { class: "picked" }, h("b", {}, S.product!.styleNumber), " ", S.product!.name));
      placementSel.replaceChildren(...presetsFor(S.product!.hat ? "hat" : "shirt").map((p) => h("option", { value: p.id, selected: p.id === S.placement }, p.label)));
      S.placement = placementSel.value;
      renderColors();
    } catch (e) { resultsBox.replaceChildren(h("p", { class: "err" }, errMsg(e))); }
  }

  function renderColors() {
    const cs = S.product?.colors ?? [];
    colorsBox.replaceChildren(...cs.map((c) => {
      const b = h("button", { class: `chip ${S.picked.has(c.name) ? "on" : ""}`, title: c.name, onclick: () => {
        if (S.picked.has(c.name)) S.picked.delete(c.name); else S.picked.add(c.name);
        b.classList.toggle("on");
        schedule();
      } }, h("i", { style: { background: c.hexes[0] ?? "#ccc" } }), c.name);
      return b;
    }));
  }
  function renderUploads() {
    colorsBox.replaceChildren(...S.uploads.map((c, i) => h("span", { class: "chip on" }, c.name,
      h("button", { class: "x", title: "Remove", onclick: () => { S.uploads.splice(i, 1); renderUploads(); schedule(); } }, "×"))));
  }

  const placementSel = h("select", { onchange: () => {
    S.placement = placementSel.value;
    S.offsetX = 0; S.offsetY = 0; offXR.set(0); offR.set(0);
    schedule();
  } },
    ...presetsFor("shirt").map((p) => h("option", { value: p.id, selected: p.id === S.placement }, p.label))) as HTMLSelectElement;
  const sizeR = range(30, 200, S.sizePct, 1, (v) => { S.sizePct = v; schedule(); }, (v) => `${v}%`);
  const signed = (v: number) => `${v > 0 ? "+" : ""}${v}`;
  const offR = range(-30, 30, S.offsetY, 0.5, (v) => { S.offsetY = v; schedule(); }, signed);
  const offXR = range(-30, 30, S.offsetX, 0.5, (v) => { S.offsetX = v; schedule(); }, signed);

  // View switch (exact vs AI drawn) above the previews.
  const viewBtns = (["exact", "ai"] as const).map((v) => h("button", { class: `seg ${S.view === v ? "on" : ""}`, onclick: () => {
    S.view = v;
    viewBtns.forEach((b, i) => b.classList.toggle("on", ["exact", "ai"][i] === v));
    refresh();
  } }, v === "exact" ? "Exact mockups" : "AI drawn"));
  const viewBar = h("div", { class: "segbar", hidden: true }, ...viewBtns);
  const setView = (v: "exact" | "ai") => { S.view = v; viewBtns.forEach((b, i) => b.classList.toggle("on", ["exact", "ai"][i] === v)); };

  // AI drawn version (OpenAI, the user's own key, stored on this Mac).
  const keyStatus = h("span", { class: "hint" }, "Checking key…");
  const keyIn = h("input", { type: "password", placeholder: "Paste your OpenAI API key (sk-…)", autocomplete: "off" }) as HTMLInputElement;
  const keyRow = h("div", { class: "row" }, keyIn, h("button", { class: "btn", onclick: async () => {
    try { await saveKey(keyIn.value); keyIn.value = ""; await showKey(); toast("Key saved on this Mac", "ok"); }
    catch (e) { toast(errMsg(e), "err"); }
  } }, "Save key"));
  const changeKey = h("button", { class: "btn ghost small", onclick: async () => { await forgetKey(); await showKey(); } }, "Remove key");
  async function showKey() {
    try {
      const hint = await savedKeyHint();
      keyStatus.textContent = hint ? `OpenAI key saved on this Mac (…${hint})` : "No OpenAI key yet — it stays on this Mac only.";
      keyRow.hidden = !!hint; changeKey.hidden = !hint;
    } catch { keyStatus.textContent = "Click any button once to give the app access, then reopen this tab."; }
  }
  let keyChecked = false;
  const qualitySel = h("select", {}, h("option", { value: "high" }, "High quality"), h("option", { value: "medium" }, "Medium (faster, cheaper)")) as HTMLSelectElement;
  const exactChk = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  const aiNotes = h("textarea", { rows: 2, placeholder: "Optional, e.g. thicker outlines, softer shading, show the hood up" }) as HTMLTextAreaElement;
  const aiBtn = h("button", { class: "btn", onclick: async () => {
    const colors = chosenColors();
    if (!S.logo || !colors.length) return toast("Add a logo and pick at least one garment.", "err");
    if (!(await savedKeyHint())) { await showKey(); return toast("Add your OpenAI API key first.", "err"); }
    busy(aiBtn, true, "Drawing…");
    let done = 0, failed = 0;
    const todo = [...colors];
    const worker = async () => {
      for (let c = todo.shift(); c; c = todo.shift()) {
        try {
          const shot = await renderOne(c);
          const L = shot.L;
          const img = await aiDraw({
            mockup: shot.canvas,
            logoRect: { x: L.x * shot.k, y: L.y * shot.k, w: L.width * shot.k, h: L.height * shot.k },
            logo: shot.logo, garment: garmentName(c), notes: aiNotes.value.trim(),
            quality: qualitySel.value as "high" | "medium", exactLogo: exactChk.checked,
          });
          S.ai.set(c.name, img);
        } catch (e) { failed++; toast(`${c.name}: ${errMsg(e)}`, "err"); }
        done++;
        aiBtn.textContent = `Drawing ${done}/${colors.length}…`;
        if (S.view === "ai") refresh();
      }
    };
    setView("ai");
    refresh();
    await Promise.all([worker(), worker()]);
    busy(aiBtn, false);
    refresh();
    if (done - failed) toast(`${done - failed} AI drawing${done - failed > 1 ? "s" : ""} ready — Save keeps the view you're on`, "ok");
  } }, "Make AI drawings") as HTMLButtonElement;
  const aiSection = h("details", { class: "ai-box", ontoggle: () => { if (!keyChecked) { keyChecked = true; showKey(); } } },
    h("summary", {}, "AI drawn version (illustrated look)"),
    h("p", { class: "hint" }, "Turns each mockup into a clean drawn garment, like a graphic or tech flat. Uses your OpenAI account; each colour is one image."),
    keyStatus, keyRow, changeKey,
    field("Quality", qualitySel),
    h("label", { class: "check" }, exactChk, "Keep my exact logo on top (recommended)"),
    aiNotes, aiBtn,
  );
  const modelChk = h("input", { type: "checkbox", onchange: (e: Event) => { S.onModel = (e.target as HTMLInputElement).checked; schedule(); } });

  const instr = h("textarea", { rows: 3, placeholder: "e.g. On Black and Navy, make the black text white. Add a navy outline around the gold on the Gold shirt." }) as HTMLTextAreaElement;
  const fixBtn = h("button", { class: "btn", onclick: async () => {
    if (!S.logo) return toast("Add a logo first.", "err");
    const colors = chosenColors();
    if (!colors.length) return toast("Pick at least one garment colour.", "err");
    busy(fixBtn, true, "Claude is adjusting…");
    try {
      const r = await claudeFix(instr.value.trim(), colors);
      S.edits = r.edits;
      editNote.textContent = r.note || "Adjusted.";
      refresh();
    } catch (e: any) {
      toast(e?.code === "not_granted" ? "Claude wasn't allowed for this app." : errMsg(e), "err");
    } finally { busy(fixBtn, false); }
  } }, "Adjust colours with Claude") as HTMLButtonElement;
  const resetBtn = h("button", { class: "btn ghost", onclick: () => { S.edits = {}; editNote.textContent = ""; refresh(); } }, "Undo adjustments");

  const jobInput = h("input", { type: "text", placeholder: "Job name (folder name)", oninput: () => (S.job = jobInput.value) }) as HTMLInputElement;
  const saveBtn = h("button", { class: "btn primary", onclick: async () => {
    const colors = chosenColors();
    if (!S.logo || !colors.length) return toast("Add a logo and at least one garment.", "err");
    busy(saveBtn, true, "Rendering…");
    try {
      const dir = `${await root("Mockups")}/${safeName(S.job || "Mockups")}_${stamp()}`;
      await D.fs.mkdir(dir, { recursive: true });
      const shots: HTMLCanvasElement[] = [];
      const style = S.source === "upload" ? "" : `${S.product?.styleNumber ?? ""}_`;
      const ai = S.view === "ai";
      if (ai && !colors.some((c) => S.ai.has(c.name))) throw new Error("No AI drawings yet — press Make AI drawings first.");
      for (const [i, c] of colors.entries()) {
        saveBtn.textContent = `Saving ${i + 1}/${colors.length}…`;
        const cv = ai ? S.ai.get(c.name) : (await renderOne(c)).canvas;
        if (!cv) continue;
        shots.push(cv);
        await writeBig(`${dir}/${safeName(style + c.name + "_" + preset().label + (ai ? "_drawn" : ""))}.jpg`, await canvasBytes(cv, "image/jpeg", 0.92));
      }
      if (shots.length > 1) {
        const rows: HTMLCanvasElement[][] = [];
        const per = shots.length <= 4 ? shots.length : Math.ceil(shots.length / Math.ceil(shots.length / 4));
        for (let i = 0; i < shots.length; i += per) rows.push(shots.slice(i, i + per).map((s) => shrink(s, 1600)));
        await writeBig(`${dir}/_all-colors.jpg`, await canvasBytes(combineGrid(rows), "image/jpeg", 0.9));
      }
      await openFolder(dir);
      notify(`Saved ${shots.length} mockup${shots.length > 1 ? "s" : ""} to JM Renders/Mockups`);
      toast(`Saved ${shots.length} mockups`, "ok");
    } catch (e) { toast(errMsg(e), "err"); } finally { busy(saveBtn, false); }
  } }, "Save mockups") as HTMLButtonElement;

  return h("section", { class: "tab", id: "tab-mockups" },
    h("aside", { class: "panel" },
      h("h3", {}, "1 · Logo"),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => logoInput.click() }, "Choose logo"), logoInput),
      logoBox,
      h("label", { class: "check" }, cutChk, "Remove the background"),
      field("Background match", tolR.wrap),
      h("label", { class: "check" }, holeChk, "Also clear it inside letters / enclosed areas"),
      h("h3", {}, "2 · Garments"),
      field("Source", srcSel),
      searchRow, uploadRow, resultsBox, colorsBox,
      h("label", { class: "check" }, modelChk, "Photos are on a model (not flat)"),
      h("h3", {}, "3 · Placement"),
      field("Placement", placementSel),
      field("Size", sizeR.wrap),
      h("p", { class: "hint" }, "Tip: drag the logo on any preview to move it."),
      field("Move left / right", offXR.wrap, "% of the garment width"),
      field("Move up / down", offR.wrap, "% of the garment height"),
      h("h3", {}, "4 · Colour fixes (optional)"),
      instr, h("div", { class: "row" }, fixBtn, resetBtn), editNote,
      h("h3", {}, "5 · AI drawn version (optional)"),
      aiSection,
      h("h3", {}, "6 · Save"),
      jobInput, saveBtn,
      h("p", { class: "hint" }, "Saves the view showing above the previews: exact mockups or AI drawings."),
    ),
    h("main", { class: "stage" }, viewBar, preview),
  );
}

function shrink(c: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(c.width, c.height));
  if (k === 1) return c;
  const o = document.createElement("canvas");
  o.width = Math.round(c.width * k); o.height = Math.round(c.height * k);
  const x = o.getContext("2d")!;
  x.imageSmoothingQuality = "high";
  x.drawImage(c, 0, 0, o.width, o.height);
  return o;
}
