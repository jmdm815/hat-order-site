// Logo background editor: automatic removal first, then the user fixes it by
// clicking an area (removes it, or brings it back if it was removed) or with a
// brush (Erase / Restore). Works on a copy of the logo at most 2400 px on the
// long side; `keep` holds 0-255 per pixel (255 = keep, 0 = see-through).
import { h, range } from "./ui";

const MAX = 2400;

export class LogoEditor {
  W = 0; H = 0;
  orig: Uint8ClampedArray | null = null;
  keep: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(0);
  history: Uint8ClampedArray[] = [];
  info = "";
  auto = true; holes = false; tol = 28;
  tool: "area" | "brush" = "area";
  brushMode: "erase" | "restore" = "restore";
  brushPct = 3;
  showRemoved = true;

  view: HTMLCanvasElement = h("canvas", { class: "le-canvas" }) as HTMLCanvasElement;
  el: HTMLElement;
  private toolbar: HTMLElement;
  private modal: HTMLElement | null = null;
  private home: HTMLElement;
  private infoEl = h("p", { class: "hint" });
  private undoBtn: HTMLButtonElement;
  private cursor = h("div", { class: "le-cursor", hidden: true });

  constructor(private onChange: (logo: HTMLCanvasElement) => void) {
    const toolBtns = (["area", "brush"] as const).map((t) => h("button", { class: `seg ${this.tool === t ? "on" : ""}`, onclick: () => {
      this.tool = t; toolBtns.forEach((b, i) => b.classList.toggle("on", ["area", "brush"][i] === t)); brushRow.hidden = t !== "brush";
    } }, t === "area" ? "Click an area" : "Brush"));
    const modeBtns = (["restore", "erase"] as const).map((m) => h("button", { class: `seg ${this.brushMode === m ? "on" : ""}`, onclick: () => {
      this.brushMode = m; modeBtns.forEach((b, i) => b.classList.toggle("on", ["restore", "erase"][i] === m));
    } }, m === "restore" ? "Bring back" : "Erase"));
    const sizeR = range(1, 12, this.brushPct, 0.5, (v) => (this.brushPct = v), (v) => `${v}%`);
    const brushRow = h("div", { class: "le-row", hidden: true }, h("div", { class: "segbar" }, ...modeBtns), h("span", { class: "lbl" }, "Size"), sizeR.wrap);
    this.undoBtn = h("button", { class: "btn small", disabled: true, onclick: () => this.undo() }, "Undo") as HTMLButtonElement;
    const showChk = h("input", { type: "checkbox", checked: this.showRemoved, onchange: () => { this.showRemoved = showChk.checked; this.draw(); } }) as HTMLInputElement;
    this.toolbar = h("div", { class: "le-tools" },
      h("div", { class: "le-row" }, h("div", { class: "segbar" }, ...toolBtns), this.undoBtn,
        h("button", { class: "btn small ghost", onclick: () => { this.push(); this.autoCut(); this.commit(); } }, "Start over"),
        h("button", { class: "btn small ghost le-expand", onclick: () => (this.modal ? this.closeBig() : this.openBig()) }, "Bigger view")),
      brushRow,
      h("label", { class: "check small" }, showChk, "Show removed parts in red"),
      h("p", { class: "hint le-help" }, "Click an area to remove it, or click a red (removed) area to bring it back. Use Brush for small spots."),
    );
    const stage = h("div", { class: "le-stage checker" }, this.view, this.cursor);
    this.home = h("div", { class: "le-home" }, stage);
    this.el = h("div", { class: "logo-editor" }, this.home, this.toolbar, this.infoEl);
    this.bindPointer(stage);
  }

  get loaded() { return !!this.orig; }

  load(img: HTMLImageElement) {
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.imageSmoothingQuality = "high";
    x.drawImage(img, 0, 0, c.width, c.height);
    // Trim see-through padding: some files are a white box on a transparent canvas.
    const full = x.getImageData(0, 0, c.width, c.height);
    const b = bounds(full.data, c.width, c.height, 8) ?? { x0: 0, y0: 0, x1: c.width - 1, y1: c.height - 1 };
    this.W = b.x1 - b.x0 + 1; this.H = b.y1 - b.y0 + 1;
    this.orig = x.getImageData(b.x0, b.y0, this.W, this.H).data;
    this.view.width = this.W; this.view.height = this.H;
    this.history = [];
    this.autoCut();
    this.commit();
  }

  /** Automatic removal: flood the background colour in from the edges. */
  autoCut() {
    const d = this.orig!, W = this.W, H = this.H;
    this.keep = new Uint8ClampedArray(W * H).fill(255);
    if (!this.auto) { this.info = ""; return; }
    const counts = new Map<number, number>();
    let edge = 0, opaque = 0;
    const band = Math.max(2, Math.round(Math.min(W, H) * 0.006)); // look a few px in, past thin frame lines
    const sample = (x: number, y: number) => {
      const i = (y * W + x) * 4; edge++;
      if (d[i + 3] < 200) return;
      opaque++;
      const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    };
    for (let x = 0; x < W; x++) { sample(x, 0); sample(x, H - 1); sample(x, Math.min(H - 1, band)); sample(x, Math.max(0, H - 1 - band)); }
    for (let y = 0; y < H; y++) { sample(0, y); sample(W - 1, y); sample(Math.min(W - 1, band), y); sample(Math.max(0, W - 1 - band), y); }
    if (opaque < edge * 0.3 || !counts.size) { this.info = "This logo already has a see-through background. Use the tools below to remove anything else."; return; }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const bg = [((top >> 10) & 31) * 8 + 4, ((top >> 5) & 31) * 8 + 4, (top & 31) * 8 + 4];
    const T = this.tol * 3, soft = T * 1.7;
    const dist = (p: number) => { const i = p * 4; return Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]); };
    const mark = new Uint8Array(W * H);
    if (this.holes) {
      for (let p = 0; p < W * H; p++) if (dist(p) <= T) mark[p] = 1;
    } else {
      const stack: number[] = [];
      const push = (p: number) => { if (!mark[p] && dist(p) <= T) { mark[p] = 1; stack.push(p); } };
      for (let x = 0; x < W; x++) for (let k = 0; k <= band; k++) { push(k * W + x); push((H - 1 - k) * W + x); }
      for (let y = 0; y < H; y++) for (let k = 0; k <= band; k++) { push(y * W + k); push(y * W + W - 1 - k); }
      flood(stack, W, H, push);
    }
    let removed = 0;
    for (let p = 0; p < W * H; p++) {
      if (mark[p]) { this.keep[p] = 0; removed++; continue; }
      const x = p % W, y = (p / W) | 0;
      const near = (x > 0 && mark[p - 1]) || (x < W - 1 && mark[p + 1]) || (y > 0 && mark[p - W]) || (y < H - 1 && mark[p + W]);
      if (near) { const k = dist(p); if (k < soft) this.keep[p] = Math.round(255 * Math.max(0, (k - T) / (soft - T))); }
    }
    // Thin frame lines left around the edge: clear them if they're cut off by removed background.
    this.info = `Removed the background colour (${hex(bg)}) — ${Math.round((removed / (W * H)) * 100)}% of the image.`;
  }

  /** Click: remove the connected area of similar colour, or bring it back. */
  toggleArea(px: number, py: number) {
    const d = this.orig!, W = this.W, H = this.H;
    const s = py * W + px, si = s * 4;
    const target = this.keep[s] > 127 ? 0 : 255;
    const T = Math.max(30, this.tol * 3);
    const [r, g, b] = [d[si], d[si + 1], d[si + 2]];
    const seen = new Uint8Array(W * H);
    const stack: number[] = [];
    const push = (p: number) => {
      if (seen[p]) return;
      const i = p * 4;
      if (d[i + 3] < 8) return;
      if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) > T) return;
      if ((this.keep[p] > 127 ? 255 : 0) === target) return; // already in the wanted state
      seen[p] = 1; stack.push(p);
    };
    push(s);
    flood(stack, W, H, push);
    for (let p = 0; p < W * H; p++) if (seen[p]) this.keep[p] = target;
    // Soften the new edge by one pixel when removing.
    if (target === 0) for (let p = 0; p < W * H; p++) {
      if (seen[p] || this.keep[p] === 0) continue;
      const x = p % W, y = (p / W) | 0;
      if ((x > 0 && seen[p - 1]) || (x < W - 1 && seen[p + 1]) || (y > 0 && seen[p - W]) || (y < H - 1 && seen[p + W])) this.keep[p] = Math.min(this.keep[p], 140);
    }
  }

  brush(px: number, py: number) {
    const r = Math.max(1, (this.brushPct / 100) * Math.max(this.W, this.H));
    const v = this.brushMode === "restore" ? 255 : 0;
    const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(this.W - 1, Math.ceil(px + r));
    const y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(this.H - 1, Math.ceil(py + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dd = Math.hypot(x - px, y - py);
      if (dd > r) continue;
      const p = y * this.W + x;
      // Soft rim so brushed edges don't look cut out.
      const edge = Math.min(1, (r - dd) / Math.max(1, r * 0.25));
      this.keep[p] = v ? Math.max(this.keep[p], 255 * edge) : Math.min(this.keep[p], 255 * (1 - edge));
    }
  }

  push() {
    this.history.push(this.keep.slice());
    if (this.history.length > 25) this.history.shift();
    this.undoBtn.disabled = false;
  }
  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.keep = prev;
    this.undoBtn.disabled = !this.history.length;
    this.commit();
  }

  draw() {
    if (!this.orig) return;
    const out = new ImageData(this.W, this.H);
    const o = out.data, d = this.orig;
    for (let p = 0, i = 0; p < this.W * this.H; p++, i += 4) {
      const k = this.keep[p] / 255;
      if (this.showRemoved && k < 0.5 && d[i + 3] > 8) {
        // Removed: faint red so it can be clicked back.
        o[i] = 237; o[i + 1] = 40; o[i + 2] = 50; o[i + 3] = 70;
      } else {
        o[i] = d[i]; o[i + 1] = d[i + 1]; o[i + 2] = d[i + 2]; o[i + 3] = d[i + 3] * k;
      }
    }
    this.view.getContext("2d")!.putImageData(out, 0, 0);
    this.infoEl.textContent = this.info;
  }

  /** The finished logo (see-through where removed), trimmed. */
  result(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.W; c.height = this.H;
    const img = new ImageData(this.W, this.H);
    const o = img.data, d = this.orig!;
    for (let p = 0, i = 0; p < this.W * this.H; p++, i += 4) {
      o[i] = d[i]; o[i + 1] = d[i + 1]; o[i + 2] = d[i + 2]; o[i + 3] = (d[i + 3] * this.keep[p]) / 255;
    }
    const b = bounds(o, this.W, this.H, 8);
    if (!b) { c.getContext("2d")!.putImageData(img, 0, 0); return c; }
    c.width = b.x1 - b.x0 + 1; c.height = b.y1 - b.y0 + 1;
    c.getContext("2d")!.putImageData(img, -b.x0, -b.y0);
    return c;
  }

  commit() { this.draw(); this.onChange(this.result()); }

  private bindPointer(stage: HTMLElement) {
    let drawing = false, raf = 0, pending: [number, number] | null = null;
    const toPx = (e: PointerEvent): [number, number] => {
      const r = this.view.getBoundingClientRect();
      return [Math.max(0, Math.min(this.W - 1, Math.round(((e.clientX - r.left) / r.width) * this.W))), Math.max(0, Math.min(this.H - 1, Math.round(((e.clientY - r.top) / r.height) * this.H)))];
    };
    const showCursor = (e: PointerEvent) => {
      if (this.tool !== "brush" || !this.orig) { this.cursor.hidden = true; return; }
      const r = this.view.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      const d = ((this.brushPct / 100) * Math.max(this.W, this.H) * 2 * r.width) / this.W;
      Object.assign(this.cursor.style, { width: `${d}px`, height: `${d}px`, left: `${e.clientX - sr.left - d / 2}px`, top: `${e.clientY - sr.top - d / 2}px` });
      this.cursor.hidden = false;
    };
    stage.addEventListener("pointerdown", (e) => {
      if (!this.orig || e.button !== 0) return;
      e.preventDefault();
      const [x, y] = toPx(e);
      this.push();
      if (this.tool === "area") { this.toggleArea(x, y); this.commit(); return; }
      drawing = true;
      stage.setPointerCapture(e.pointerId);
      this.brush(x, y); this.draw();
    });
    stage.addEventListener("pointermove", (e) => {
      showCursor(e);
      if (!drawing) return;
      pending = toPx(e);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) { this.brush(...pending); pending = null; this.draw(); } });
    });
    const end = () => { if (drawing) { drawing = false; this.commit(); } };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("pointerleave", () => (this.cursor.hidden = true));
  }

  private openBig() {
    const stage = this.home.firstElementChild!;
    const box = h("div", { class: "le-modal-box" }, h("div", { class: "le-modal-head" }, h("b", {}, "Logo background"), h("button", { class: "btn primary small", onclick: () => this.closeBig() }, "Done")), stage, this.toolbar);
    this.modal = h("div", { class: "le-modal", onclick: (e: Event) => { if (e.target === this.modal) this.closeBig(); } }, box);
    (this.el.closest(".rs-app") ?? document.body).append(this.modal);
    this.toolbar.querySelector(".le-expand")!.textContent = "Smaller view";
  }
  private closeBig() {
    const stage = this.modal?.querySelector(".le-stage");
    if (stage) this.home.append(stage);
    this.el.insertBefore(this.toolbar, this.infoEl);
    this.modal?.remove();
    this.modal = null;
    this.toolbar.querySelector(".le-expand")!.textContent = "Bigger view";
  }
}

function flood(stack: number[], W: number, H: number, push: (p: number) => void) {
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (y > 0) push(p - W);
    if (y < H - 1) push(p + W);
  }
}

function bounds(d: Uint8ClampedArray, W: number, H: number, a: number) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > a) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const hex = (c: number[]) => "#" + c.map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("").toUpperCase();
