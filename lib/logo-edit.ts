import sharp from "sharp";

// ---------------------------------------------------------------------------
// Exact logo edits for the AI Mockup Studio. Claude (lib/logo-edit-plan.ts)
// decides WHAT to change per garment color; this file does the pixel work,
// deterministically, so the logo stays sharp (no AI redraw):
//   recolor  — shift one logo color to another (optionally inside a box)
//   outline  — stroke around the whole badge, or around one color's shapes
//   backing  — fill see-through areas inside the logo (e.g. a white center)
// Boxes are fractions of the logo (0..1). Output is for mockups only.
// ---------------------------------------------------------------------------

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type EditOp =
  | { op: "recolor"; from: string; to: string; tolerance?: number; region?: Box }
  | { op: "outline"; color: string; width?: number; around?: "logo" | string; region?: Box }
  | { op: "backing"; color: string };

export type PaletteColor = { hex: string; coverage: number; box: Box };

const MAX_SIDE = 3000; // mockups never need more

type Img = { d: Uint8ClampedArray; w: number; h: number };

async function load(buf: Buffer, maxSide = MAX_SIDE): Promise<Img> {
  const { data, info } = await sharp(buf)
    .rotate()
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { d: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
}

const toPng = (im: Img) =>
  sharp(Buffer.from(im.d.buffer, im.d.byteOffset, im.d.length), { raw: { width: im.w, height: im.h, channels: 4 } })
    .png()
    .toBuffer();

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) throw new Error(`Bad color "${hex}"`);
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const hexOf = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------- analysis
/** Main colors of the logo (opaque pixels) with coverage and where they sit. */
export async function analyzeLogo(buf: Buffer): Promise<{ palette: PaletteColor[]; w: number; h: number; hasHoles: boolean }> {
  const im = await load(buf, 600);
  const { d, w, h } = im;
  type B = { n: number; r: number; g: number; b: number; x0: number; y0: number; x1: number; y1: number };
  const buckets = new Map<number, B>();
  let opaque = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 200) continue;
      opaque++;
      const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      const b = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0, x0: x, y0: y, x1: x, y1: y };
      b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
      b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y);
      buckets.set(k, b);
    }
  // Merge similar buckets, biggest first.
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  const groups: B[] = [];
  for (const b of sorted) {
    const [r, g, bl] = [b.r / b.n, b.g / b.n, b.b / b.n];
    const hit = groups.find((gp) => Math.hypot(gp.r / gp.n - r, gp.g / gp.n - g, gp.b / gp.n - bl) < 48);
    if (hit) {
      hit.n += b.n; hit.r += b.r; hit.g += b.g; hit.b += b.b;
      hit.x0 = Math.min(hit.x0, b.x0); hit.y0 = Math.min(hit.y0, b.y0); hit.x1 = Math.max(hit.x1, b.x1); hit.y1 = Math.max(hit.y1, b.y1);
    } else groups.push({ ...b });
  }
  const palette = groups
    .filter((g) => g.n / Math.max(1, opaque) > 0.01)
    .slice(0, 8)
    .map((g) => ({
      hex: hexOf(g.r / g.n, g.g / g.n, g.b / g.n),
      coverage: Math.round((g.n / opaque) * 1000) / 10,
      box: { x0: +(g.x0 / w).toFixed(3), y0: +(g.y0 / h).toFixed(3), x1: +(g.x1 / w).toFixed(3), y1: +(g.y1 / h).toFixed(3) },
    }));
  const holes = enclosedTransparent(im);
  let holeCount = 0;
  for (let i = 0; i < holes.length; i++) holeCount += holes[i];
  return { palette, w, h, hasHoles: holeCount / (w * h) > 0.02 };
}

// ---------------------------------------------------------------- helpers
/** 1 where a pixel is see-through but NOT connected to the outside edge (holes inside the logo). */
function enclosedTransparent(im: Img, alphaCut = 128): Uint8Array {
  const { d, w, h } = im;
  const N = w * h;
  const outside = new Uint8Array(N);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  const push = (p: number) => {
    if (!outside[p] && d[p * 4 + 3] < alphaCut) { outside[p] = 1; q[qt++] = p; }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (qh < qt) {
    const p = q[qh++], x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const holes = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (!outside[p] && d[p * 4 + 3] < alphaCut) holes[p] = 1;
  return holes;
}

/** Approximate Euclidean distance (px) from every pixel to the nearest `mask` pixel (two-pass chamfer). */
function distanceTo(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9, D1 = 1, D2 = Math.SQRT2;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? 0 : INF;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = dist[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, dist[i - 1] + D1);
      if (y > 0) {
        v = Math.min(v, dist[i - w] + D1);
        if (x > 0) v = Math.min(v, dist[i - w - 1] + D2);
        if (x < w - 1) v = Math.min(v, dist[i - w + 1] + D2);
      }
      dist[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = dist[i];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, dist[i + 1] + D1);
      if (y < h - 1) {
        v = Math.min(v, dist[i + w] + D1);
        if (x < w - 1) v = Math.min(v, dist[i + w + 1] + D2);
        if (x > 0) v = Math.min(v, dist[i + w - 1] + D2);
      }
      dist[i] = v;
    }
  return dist;
}

function pad(im: Img, p: number): Img {
  const w = im.w + 2 * p, h = im.h + 2 * p;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < im.h; y++) d.set(im.d.subarray(y * im.w * 4, (y + 1) * im.w * 4), ((y + p) * w + p) * 4);
  return { d, w, h };
}

/** Paint `color` UNDER the logo wherever `cover` (0..1) is set. */
function paintUnder(im: Img, cover: Float32Array, [r, g, b]: [number, number, number]) {
  const { d } = im;
  for (let p = 0; p < cover.length; p++) {
    const ca = cover[p];
    if (ca <= 0) continue;
    const i = p * 4, la = d[i + 3] / 255;
    const oa = la + ca * (1 - la);
    if (oa <= 0) continue;
    d[i] = (d[i] * la + r * ca * (1 - la)) / oa;
    d[i + 1] = (d[i + 1] * la + g * ca * (1 - la)) / oa;
    d[i + 2] = (d[i + 2] * la + b * ca * (1 - la)) / oa;
    d[i + 3] = oa * 255;
  }
}

// ---------------------------------------------------------------- ops
/** Matching pixels inside `region`: whole connected shapes whose bounds sit inside the box
 *  (so a box around "Leading the Way" never clips into a banner it overlaps). */
function shapesInRegion(im: Img, match: Uint8Array, region?: Box): Uint8Array {
  const { w, h } = im;
  if (!region) return match;
  const sel = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  const slack = 0.01;
  for (let s = 0; s < match.length; s++) {
    if (!match[s] || seen[s]) continue;
    let qh = 0, qt = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    q[qt++] = s; seen[s] = 1;
    while (qh < qt) {
      const p = q[qh++], x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const n of nb) if (n >= 0 && match[n] && !seen[n]) { seen[n] = 1; q[qt++] = n; }
    }
    const inside = x0 / w >= region.x0 - slack && x1 / w <= region.x1 + slack && y0 / h >= region.y0 - slack && y1 / h <= region.y1 + slack;
    if (inside) for (let k = 0; k < qt; k++) sel[q[k]] = 1;
  }
  return sel;
}

function recolor(im: Img, op: Extract<EditOp, { op: "recolor" }>) {
  const [fr, fg, fb] = parseHex(op.from);
  const [tr, tg, tb] = parseHex(op.to);
  const tol = Math.max(10, Math.min(160, op.tolerance ?? 70));
  const { d, w, h } = im;
  const match = new Uint8Array(w * h);
  for (let p = 0; p < match.length; p++) {
    const i = p * 4;
    if (d[i + 3] > 0 && Math.hypot(d[i] - fr, d[i + 1] - fg, d[i + 2] - fb) < tol) match[p] = 1;
  }
  const sel = shapesInRegion(im, match, op.region);
  for (let p = 0; p < sel.length; p++) {
    if (!sel[p]) continue;
    const i = p * 4;
    const dist = Math.hypot(d[i] - fr, d[i + 1] - fg, d[i + 2] - fb);
    // Full change near the color, fading toward the tolerance so anti-aliased
    // edges blend instead of leaving a fringe.
    const k = dist < tol * 0.5 ? 1 : 1 - (dist - tol * 0.5) / (tol * 0.5);
    d[i] = d[i] + (tr - fr) * k;
    d[i + 1] = d[i + 1] + (tg - fg) * k;
    d[i + 2] = d[i + 2] + (tb - fb) * k;
  }
}

function outline(im: Img, op: Extract<EditOp, { op: "outline" }>): Img {
  // width = % of the logo's width (1 ≈ a thin keyline, 2 ≈ bold).
  const wpx = Math.max(2, Math.round(((op.width ?? 1.2) / 100) * Math.max(im.w, im.h)));
  const color = parseHex(op.color);
  if (!op.around || op.around === "logo") {
    const P = wpx + 4;
    const out = pad(im, P);
    const { d, w, h } = out;
    const holes = enclosedTransparent(out);
    const solid = new Uint8Array(w * h);
    for (let p = 0; p < solid.length; p++) solid[p] = d[p * 4 + 3] >= 128 || holes[p] ? 1 : 0;
    const dist = distanceTo(solid, w, h);
    const cover = new Float32Array(w * h);
    for (let p = 0; p < cover.length; p++) if (!solid[p]) cover[p] = Math.max(0, Math.min(1, wpx + 1 - dist[p]));
    paintUnder(out, cover, color);
    return out;
  }
  // Around the shapes of one color (e.g. a gold line that vanishes on a yellow shirt).
  const [fr, fg, fb] = parseHex(op.around);
  const { d, w, h } = im;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4;
      if (d[i + 3] >= 128 && Math.hypot(d[i] - fr, d[i + 1] - fg, d[i + 2] - fb) < 60) mask[p] = 1;
    }
  const sel = shapesInRegion(im, mask, op.region);
  mask.set(sel);
  const thin = Math.max(2, Math.round(wpx * 0.5));
  const dist = distanceTo(mask, w, h);
  const cover = new Float32Array(w * h);
  // Only on see-through pixels, so it never paints over other parts of the logo.
  for (let p = 0; p < cover.length; p++) if (!mask[p] && d[p * 4 + 3] < 255) cover[p] = Math.max(0, Math.min(1, thin + 1 - dist[p]));
  paintUnder(im, cover, color);
  return im;
}

function backing(im: Img, op: Extract<EditOp, { op: "backing" }>) {
  const holes = enclosedTransparent(im);
  const cover = new Float32Array(holes.length);
  for (let p = 0; p < holes.length; p++) if (holes[p]) cover[p] = 1;
  paintUnder(im, cover, parseHex(op.color));
}

/** Apply edits in order; returns a transparent PNG (max 3000 px). */
export async function applyEdits(logo: Buffer, ops: EditOp[]): Promise<Buffer> {
  let im = await load(logo);
  // Backing first (it fills holes the outline step would otherwise treat as outside).
  const ordered = [...ops.filter((o) => o.op === "backing"), ...ops.filter((o) => o.op === "recolor"), ...ops.filter((o) => o.op === "outline" && o.around && o.around !== "logo"), ...ops.filter((o) => o.op === "outline" && (!o.around || o.around === "logo"))];
  for (const op of ordered) {
    if (op.op === "recolor") recolor(im, op);
    else if (op.op === "backing") backing(im, op);
    else im = outline(im, op);
  }
  return toPng(im);
}

/** Validate ops from the model / client; drops anything malformed. */
export function sanitizeOps(raw: unknown): EditOp[] {
  if (!Array.isArray(raw)) return [];
  const hexOk = (v: unknown): v is string => typeof v === "string" && /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v.trim());
  const box = (v: unknown): Box | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const b = v as Record<string, unknown>;
    const n = (k: string) => Math.max(0, Math.min(1, Number(b[k])));
    if (![b.x0, b.y0, b.x1, b.y1].every((x) => Number.isFinite(Number(x)))) return undefined;
    return { x0: n("x0"), y0: n("y0"), x1: n("x1"), y1: n("y1") };
  };
  const out: EditOp[] = [];
  for (const o of raw.slice(0, 12)) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    if (r.op === "recolor" && hexOk(r.from) && hexOk(r.to))
      out.push({ op: "recolor", from: r.from, to: r.to, tolerance: Number(r.tolerance) || undefined, region: box(r.region) });
    else if (r.op === "outline" && hexOk(r.color))
      out.push({
        op: "outline",
        color: r.color,
        width: Math.max(0.3, Math.min(4, Number(r.width) || 1.2)),
        around: hexOk(r.around) ? r.around : "logo",
        region: box(r.region),
      });
    else if (r.op === "backing" && hexOk(r.color)) out.push({ op: "backing", color: r.color });
  }
  return out;
}
