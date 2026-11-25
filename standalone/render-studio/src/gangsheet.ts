// Gang sheet renderer: artwork + print width + quantity -> packed 24" wide,
// 300 dpi transparent PNG, drawn in bands and streamed to disk.
import {
  DEFAULT_GAP_IN, DPI, FALLBACK_SIZES, MAX_LENGTH_IN, SHEET_WIDTH_IN, packItems, sizeFor,
  type SheetItem, type SheetSize,
} from "../../../lib/gang-sheet";
import { API, D, fileSink, getJson, notify, openFolder, root, safeName, stamp, writeBig } from "./desktop";
import { pngStream } from "./png";
import { busy, canvasBytes, errMsg, field, fileToImage, h, toast } from "./ui";

type Art = { id: string; name: string; img: HTMLCanvasElement; vec?: HTMLImageElement; w: number; qty: number };

const S = {
  arts: [] as Art[],
  gap: DEFAULT_GAP_IN,
  sizes: FALLBACK_SIZES as SheetSize[],
  trim: true,
  name: "",
  items: [] as SheetItem[],
};

function trim(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  if (!S.trim) return c;
  const { width: W, height: H } = c;
  const d = x.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) if (d[(y * W + xx) * 4 + 3] > 4) {
    if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === W - 1 && y1 === H - 1)) return c;
  const o = document.createElement("canvas");
  o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d")!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

function trimSvgPreview(img: HTMLImageElement): HTMLCanvasElement {
  // Vector art prints sharp at any size; this canvas is only for thumbnails / ratio.
  const k = 1200 / Math.max(img.naturalWidth, img.naturalHeight);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function hasOpaqueBackground(c: HTMLCanvasElement): boolean {
  const x = c.getContext("2d", { willReadFrequently: true })!;
  const pts = [[0, 0], [c.width - 1, 0], [0, c.height - 1], [c.width - 1, c.height - 1]];
  return pts.every(([px, py]) => x.getImageData(px, py, 1, 1).data[3] > 250);
}

const hIn = (a: Art) => (a.w * a.img.height) / a.img.width;
const dpiOf = (a: Art) => (a.vec ? 300 : Math.round(a.img.width / a.w));

function pack() {
  let n = 0;
  const reqs = S.arts.flatMap((a) => Array.from({ length: Math.max(0, a.qty) }, () => ({ assetId: a.id, w: a.w, h: hIn(a) })));
  S.items = packItems(reqs, S.gap, () => `i${n++}`);
}

const used = () => S.items.reduce((m, it) => Math.max(m, it.y + it.h), 0);

/** Draw the sheet region [y0, y0+rows) (pixels) onto a band canvas. */
function drawBand(ctx: CanvasRenderingContext2D, y0: number, rows: number, scale = 1) {
  const W = ctx.canvas.width;
  ctx.clearRect(0, 0, W, ctx.canvas.height);
  const px = DPI * scale;
  for (const it of S.items) {
    const top = it.y * px, bot = (it.y + it.h) * px;
    if (bot < y0 || top > y0 + rows) continue;
    const art = S.arts.find((a) => a.id === it.assetId)!;
    ctx.save();
    ctx.translate((it.x + it.w / 2) * px, (it.y + it.h / 2) * px - y0);
    ctx.rotate((it.rot * Math.PI) / 180);
    const sw = it.rot % 180 ? it.h : it.w, shh = it.rot % 180 ? it.w : it.h;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(art.vec ?? art.img, (-sw / 2) * px, (-shh / 2) * px, sw * px, shh * px);
    ctx.restore();
  }
}

export function gangTab(): HTMLElement {
  const list = h("div", { class: "art-list" });
  const stage = h("div", { class: "sheet-wrap" });
  const info = h("div", { class: "sheet-info" });
  const lenSel = h("select", { onchange: () => redraw() }) as HTMLSelectElement;
  let sizesLoaded = false;

  async function loadSizes() {
    if (sizesLoaded) return;
    sizesLoaded = true;
    try {
      const r = await getJson(`${API}/api/gang-sheet/sizes`);
      if (Array.isArray(r.sizes) && r.sizes.length) S.sizes = r.sizes;
    } catch { /* fallback sizes */ }
  }

  function renderList() {
    list.replaceChildren(...S.arts.map((a, i) => {
      const wIn = h("input", { type: "number", min: 0.5, max: SHEET_WIDTH_IN, step: 0.25, value: String(a.w) }) as HTMLInputElement;
      const qty = h("input", { type: "number", min: 0, max: 999, step: 1, value: String(a.qty) }) as HTMLInputElement;
      const dims = h("span", { class: "hint" });
      const upd = () => {
        const d = dpiOf(a);
        dims.textContent = `${a.w}" × ${hIn(a).toFixed(2)}" · ${d} dpi`;
        dims.className = d < 150 ? "hint bad" : d < 250 ? "hint warn" : "hint";
      };
      wIn.addEventListener("input", () => { a.w = Math.min(SHEET_WIDTH_IN, Math.max(0.5, +wIn.value || a.w)); upd(); redraw(); });
      qty.addEventListener("input", () => { a.qty = Math.max(0, Math.round(+qty.value || 0)); redraw(); });
      upd();
      const thumb = a.img.cloneNode() as HTMLCanvasElement;
      thumb.getContext("2d")!.drawImage(a.img, 0, 0);
      return h("div", { class: "art" },
        h("div", { class: "thumb checker" }, thumb),
        h("div", { class: "art-body" },
          h("b", {}, a.name),
          h("div", { class: "row tight" }, field("Width (in)", wIn), field("Qty", qty)),
          dims),
        h("button", { class: "x", title: "Remove", onclick: () => { S.arts.splice(i, 1); renderList(); redraw(); } }, "×"));
    }));
  }

  function redraw() {
    pack();
    const need = used();
    const fit = sizeFor(S.sizes, need);
    const opts = [...S.sizes].sort((a, b) => a.lengthIn - b.lengthIn);
    const cur = +lenSel.value || 0;
    lenSel.replaceChildren(...opts.map((s) => h("option", { value: s.lengthIn, disabled: s.lengthIn + 0.001 < need },
      `${s.label}${s.price ? ` · $${s.price}` : ""}`)));
    const chosen = cur >= need && opts.some((o) => o.lengthIn === cur) ? cur : fit?.lengthIn ?? Math.ceil(need);
    lenSel.value = String(chosen);
    const L = +lenSel.value || Math.ceil(need) || 24;
    // Preview canvas
    const scale = Math.min(520 / (SHEET_WIDTH_IN * DPI), 1);
    const pv = h("canvas", { class: "sheet checker" }) as HTMLCanvasElement;
    pv.width = Math.round(SHEET_WIDTH_IN * DPI * scale);
    pv.height = Math.max(40, Math.round(L * DPI * scale));
    drawBand(pv.getContext("2d")!, 0, pv.height, scale);
    const pieces = S.items.length;
    const warn: string[] = [];
    if (need > MAX_LENGTH_IN) warn.push(`Needs ${need.toFixed(1)}" — longer than the ${MAX_LENGTH_IN}" maximum. Split it into two sheets.`);
    for (const a of S.arts) if (a.qty && dpiOf(a) < 150) warn.push(`${a.name} is only ${dpiOf(a)} dpi at ${a.w}" — it may print soft.`);
    for (const a of S.arts) if (a.qty && hasOpaqueBackground(a.img)) warn.push(`${a.name} has a solid background — it will print as a block.`);
    info.replaceChildren(
      h("div", { class: "stat" }, h("b", {}, pieces), h("span", {}, "pieces")),
      h("div", { class: "stat" }, h("b", {}, `${need.toFixed(1)}"`), h("span", {}, "length used")),
      h("div", { class: "stat" }, h("b", {}, `24 × ${L}"`), h("span", {}, `${(SHEET_WIDTH_IN * DPI).toLocaleString()} × ${(L * DPI).toLocaleString()} px`)),
      ...warn.map((w) => h("p", { class: "warn" }, w)));
    stage.replaceChildren(pieces ? pv : h("p", { class: "empty" }, "Add artwork to build a sheet."));
  }

  const fileIn = h("input", { type: "file", accept: "image/png,image/webp,image/jpeg,image/svg+xml", multiple: true, hidden: true, onchange: async (e: Event) => {
    loadSizes().then(redraw);
    for (const f of [...((e.target as HTMLInputElement).files ?? [])]) {
      try {
        const img = await fileToImage(f);
        const svg = f.type === "image/svg+xml" || /\.svg$/i.test(f.name);
        if (svg && (!img.naturalWidth || !img.naturalHeight)) throw new Error("This SVG has no size set; export it with a width and height.");
        const c = svg ? trimSvgPreview(img) : trim(img);
        const w = svg ? 4 : Math.min(SHEET_WIDTH_IN, Math.round((c.width / DPI) * 4) / 4 || 4);
        S.arts.push({ id: crypto.randomUUID(), name: f.name.replace(/\.[^.]+$/, ""), img: c, vec: svg ? img : undefined, w: Math.max(1, Math.min(w, 11)), qty: 1 });
        if (!S.name) { S.name = f.name.replace(/\.[^.]+$/, ""); nameIn.value = S.name; }
      } catch (err) { toast(`${f.name}: ${errMsg(err)}`, "err"); }
    }
    (e.target as HTMLInputElement).value = "";
    renderList(); redraw();
  } }) as HTMLInputElement;

  const gapIn = h("input", { type: "number", min: 0, max: 2, step: 0.05, value: String(S.gap), oninput: () => { S.gap = Math.max(0, +gapIn.value || 0); redraw(); } }) as HTMLInputElement;
  const trimChk = h("input", { type: "checkbox", checked: S.trim, onchange: () => (S.trim = trimChk.checked) }) as HTMLInputElement;
  const nameIn = h("input", { type: "text", placeholder: "Customer / job name", oninput: () => (S.name = nameIn.value) }) as HTMLInputElement;
  const prog = h("progress", { max: 1, value: 0, hidden: true }) as HTMLProgressElement;

  const renderBtn = h("button", { class: "btn primary", onclick: async () => {
    if (!S.items.length) return toast("Add artwork first.", "err");
    const L = +lenSel.value;
    if (used() > L + 0.001) return toast("The artwork doesn't fit that length.", "err");
    busy(renderBtn, true, "Rendering…");
    prog.hidden = false; prog.value = 0;
    try {
      const dir = await root("Gang Sheets");
      const base = `${safeName(S.name || "Gang-Sheet")}_24x${L}_${stamp()}`;
      const path = `${dir}/${base}.png`;
      const W = SHEET_WIDTH_IN * DPI, H = Math.round(L * DPI);
      const sink = fileSink(path);
      const png = await pngStream(W, H, DPI, (b) => sink.write(b));
      const BAND = 600;
      const band = document.createElement("canvas");
      band.width = W; band.height = BAND;
      const ctx = band.getContext("2d", { willReadFrequently: true })!;
      for (let y = 0; y < H; y += BAND) {
        const rows = Math.min(BAND, H - y);
        drawBand(ctx, y, rows);
        await png.addRows(ctx.getImageData(0, 0, W, rows).data, rows);
        prog.value = (y + rows) / H;
        renderBtn.textContent = `Rendering ${Math.round(((y + rows) / H) * 100)}%`;
      }
      await png.finish();
      await sink.close();
      // Small proof JPG next to it.
      const k = 1600 / H > 0.2 ? 0.2 : 1600 / H;
      const pv = document.createElement("canvas");
      pv.width = Math.round(W * k); pv.height = Math.round(H * k);
      const px = pv.getContext("2d")!;
      px.fillStyle = "#fff"; px.fillRect(0, 0, pv.width, pv.height);
      drawBand(px, 0, pv.height, k);
      await writeBig(`${dir}/${base}_proof.jpg`, await canvasBytes(pv, "image/jpeg", 0.85));
      await D.shell.showItemInFolder(path).catch(() => openFolder(dir));
      notify(`Gang sheet saved: ${base}.png`);
      toast(`Saved 24 × ${L}" sheet (${S.items.length} pieces)`, "ok");
    } catch (e) { toast(errMsg(e), "err"); } finally { busy(renderBtn, false); prog.hidden = true; }
  } }, "Render print PNG") as HTMLButtonElement;

  redraw();
  return h("section", { class: "tab", id: "tab-gang", hidden: true },
    h("aside", { class: "panel" },
      h("h3", {}, "1 · Artwork"),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => fileIn.click() }, "Add artwork"), fileIn),
      h("label", { class: "check" }, trimChk, "Trim empty space around each file"),
      list,
      h("h3", {}, "2 · Sheet"),
      field("Gap between pieces (in)", gapIn),
      field("Sheet length", lenSel, "Smallest size that fits is picked for you."),
      h("h3", {}, "3 · Render"),
      nameIn, renderBtn, prog,
      h("p", { class: "hint" }, `24" wide · 300 dpi · transparent PNG, saved to JM Renders/Gang Sheets with a proof JPG.`),
    ),
    h("main", { class: "stage" }, info, stage),
  );
}
