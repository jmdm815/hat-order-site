// ---------------------------------------------------------------------------
// Server-side mockups (Node + sharp): the same placement math and fabric
// shading as the admin Garment Mockup tool (lib/garment-mockup.ts), so a logo
// can be put on "a black ST350, left chest" from an API call — for Claude in
// chat and the inbox watcher — without opening the browser tool.
// ---------------------------------------------------------------------------

import sharp from "sharp";
import { removeUniformBackground, type CutoutStatus } from "./bg-remove";
import { layoutForPreset, onModelGarmentBounds, type PlacementPreset, type Rect } from "./garment-mockup";

export type Rgba = { data: Uint8ClampedArray; w: number; h: number };

export async function toRgba(buf: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(buf).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
}

export async function rgbaToPng(img: Rgba): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.w, height: img.h, channels: 4 },
  })
    .png()
    .toBuffer();
}

export async function exactCutout(buf: Buffer, holes = false): Promise<{ status: CutoutStatus; png: Buffer }> {
  const img = await toRgba(buf);
  const r = removeUniformBackground(img.data, img.w, img.h, { holes });
  return { status: r.status, png: await rgbaToPng({ ...img, data: r.data }) };
}

/** Crop fully transparent padding. */
export function trimRgba(img: Rgba): Rgba {
  const { data, w, h } = img;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return img;
  const tw = maxX - minX + 1, th = maxY - minY + 1;
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const src = ((y + minY) * w + minX) * 4;
    out.set(data.subarray(src, src + tw * 4), y * tw * 4);
  }
  return { data: out, w: tw, h: th };
}

/** Garment bounding box: pixels that differ from the corner background color. */
export async function detectGarmentBoundsNode(buf: Buffer): Promise<{ rect: Rect; W: number; H: number }> {
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? 1, H = meta.height ?? 1;
  const scale = Math.min(1, 600 / Math.max(W, H));
  const small = await toRgba(
    await sharp(buf).resize(Math.max(1, Math.round(W * scale)), Math.max(1, Math.round(H * scale))).png().toBuffer()
  );
  const { data, w, h } = small;
  const corner = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const cs = [corner(1, 1), corner(w - 2, 1), corner(1, h - 2), corner(w - 2, h - 2)];
  const bg = [0, 1, 2, 3].map((k) => cs.reduce((s, c) => s + c[k], 0) / 4);
  const transparentBg = bg[3] < 128;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      const hit = transparentBg
        ? a > 40
        : a > 40 && Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 30;
      if (hit) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  const sx = W / w, sy = H / h;
  const rect = maxX < 0 ? { x: 0, y: 0, width: W, height: H } : { x: minX * sx, y: minY * sy, width: (maxX - minX + 1) * sx, height: (maxY - minY + 1) * sy };
  return { rect, W, H };
}

export type NodeRenderOptions = {
  sizePct?: number; // 100 = fill the placement box
  fabricBlend?: number; // 0-100, default 55
  raised?: boolean; // drop shadow (embroidery / patch)
  onModel?: boolean; // photo shows a person: estimate the shirt band
};

const ON_MODEL: Partial<Record<string, { centerX: number; centerY: number; maxWidth: number; maxHeight: number }>> = {
  "left-chest": { centerX: 0.7, centerY: 0.43, maxWidth: 0.14, maxHeight: 0.1 },
  "full-front": { centerX: 0.5, centerY: 0.5, maxWidth: 0.42, maxHeight: 0.3 },
  back: { centerX: 0.5, centerY: 0.45, maxWidth: 0.44, maxHeight: 0.34 },
};

const MIN_EXPORT_LONG_SIDE = 3000;
const MAX_EXPORT_SCALE = 4;

/** Composite `logo` (transparent PNG bytes) onto the garment photo. Returns PNG + where it landed. */
export async function renderMockupNode(
  garmentBuf: Buffer,
  logoBuf: Buffer,
  preset: PlacementPreset,
  opts: NodeRenderOptions = {}
): Promise<{ png: Buffer; layout: Rect; printWidthIn: number; logoPx: { w: number; h: number } }> {
  const { rect: detected, W: bw, H: bh } = await detectGarmentBoundsNode(garmentBuf);
  const garment = opts.onModel ? onModelGarmentBounds(detected) : detected;
  const logo = trimRgba(await toRgba(logoBuf));
  // On-model photos: place relative to the whole person (calibrated on
  // SanMar's front-facing model shots) instead of the flat-lay fractions.
  const om = opts.onModel ? ON_MODEL[preset.id] : undefined;
  const layout = om
    ? layoutForPreset({ ...preset, ...om }, detected, logo.w, logo.h, opts.sizePct ?? 100)
    : layoutForPreset(preset, garment, logo.w, logo.h, opts.sizePct ?? 100);

  const k = Math.min(MAX_EXPORT_SCALE, Math.max(1, MIN_EXPORT_LONG_SIDE / Math.max(bw, bh)));
  const W = Math.round(bw * k), H = Math.round(bh * k);
  const base = await toRgba(
    await sharp(garmentBuf).flatten({ background: "#ffffff" }).resize(W, H, { kernel: "lanczos3" }).png().toBuffer()
  );

  const lx = Math.round(layout.x * k), ly = Math.round(layout.y * k);
  const lw = Math.max(1, Math.round(layout.width * k)), lh = Math.max(1, Math.round(layout.height * k));
  const layer = await toRgba(
    await sharp(await rgbaToPng(logo)).resize(lw, lh, { kernel: "lanczos3", fit: "fill" }).png().toBuffer()
  );
  const lp = layer.data;

  // Fabric shading (same formula as the browser tool).
  const blend = opts.fabricBlend ?? 55;
  if (blend > 0) {
    const sx = Math.max(0, lx), sy = Math.max(0, ly), ex = Math.min(W, lx + lw), ey = Math.min(H, ly + lh);
    let sum = 0, n = 0;
    for (let y = sy; y < ey; y++)
      for (let x = sx; x < ex; x++) {
        const gi = (y * W + x) * 4;
        sum += 0.299 * base.data[gi] + 0.587 * base.data[gi + 1] + 0.114 * base.data[gi + 2];
        n++;
      }
    const mean = Math.max(1, sum / Math.max(1, n));
    const kk = (blend / 100) * 1.2;
    for (let y = sy; y < ey; y++)
      for (let x = sx; x < ex; x++) {
        const gi = (y * W + x) * 4;
        const li = ((y - ly) * lw + (x - lx)) * 4;
        if (lp[li + 3] === 0) continue;
        const L = 0.299 * base.data[gi] + 0.587 * base.data[gi + 1] + 0.114 * base.data[gi + 2];
        const f = Math.min(1.3, Math.max(0.55, 1 + (L / mean - 1) * kk));
        const lift = f > 1 ? (f - 1) * 40 : 0;
        lp[li] = Math.min(255, lp[li] * f + lift);
        lp[li + 1] = Math.min(255, lp[li + 1] * f + lift);
        lp[li + 2] = Math.min(255, lp[li + 2] * f + lift);
      }
  }

  // Alpha-composite the logo (and an optional soft shadow) onto the base.
  const out = base.data;
  const over = (src: Uint8ClampedArray, ox: number, oy: number, sw: number, sh: number) => {
    for (let y = 0; y < sh; y++) {
      const ty = y + oy;
      if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < sw; x++) {
        const tx = x + ox;
        if (tx < 0 || tx >= W) continue;
        const si = (y * sw + x) * 4;
        const a = src[si + 3] / 255;
        if (a === 0) continue;
        const di = (ty * W + tx) * 4;
        out[di] = src[si] * a + out[di] * (1 - a);
        out[di + 1] = src[si + 1] * a + out[di + 1] * (1 - a);
        out[di + 2] = src[si + 2] * a + out[di + 2] * (1 - a);
      }
    }
  };
  if (opts.raised) {
    const blur = Math.max(1, Math.round(Math.min(W, H) / 900));
    const pad = blur * 4;
    const sw = lw + pad * 2, sh = lh + pad * 2;
    const alpha = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < lh; y++)
      for (let x = 0; x < lw; x++) alpha[((y + pad) * sw + x + pad) * 4 + 3] = Math.round(lp[(y * lw + x) * 4 + 3] * 0.28);
    const blurred = await toRgba(
      await sharp(Buffer.from(alpha.buffer), { raw: { width: sw, height: sh, channels: 4 } }).blur(blur * 1.2).png().toBuffer()
    );
    over(blurred.data, lx - pad + Math.round(blur * 0.6), ly - pad + blur, sw, sh);
  }
  over(lp, lx, ly, lw, lh);

  const png = await sharp(Buffer.from(out.buffer, out.byteOffset, out.length), { raw: { width: W, height: H, channels: 4 } })
    .removeAlpha()
    .png({ compressionLevel: 8 })
    .toBuffer();
  const printWidthIn = om
    ? (layout.width / (detected.width * om.maxWidth)) * preset.nominalWidthIn
    : (layout.width / (garment.width * preset.maxWidth)) * preset.nominalWidthIn;
  return { png, layout, printWidthIn, logoPx: { w: logo.w, h: logo.h } };
}

export type CutoutMode = "auto" | "exact" | "ai" | "none";
export type CutoutMethod = "exact" | "ai" | "already-transparent" | "none";

/**
 * Logo -> transparent PNG. "auto": exact cutout first; AI only when the
 * background isn't one solid color (and an OpenAI key is set).
 */
export async function cutoutLogo(
  buf: Buffer,
  mode: CutoutMode = "auto",
  holes = false
): Promise<{ png: Buffer; method: CutoutMethod; note?: string }> {
  const asPng = await sharp(buf).rotate().png().toBuffer();
  if (mode === "none") return { png: asPng, method: "none" };
  if (mode !== "ai") {
    const exact = await exactCutout(asPng, holes);
    if (exact.status === "removed") return { png: exact.png, method: "exact" };
    if (exact.status === "already-transparent") return { png: asPng, method: "already-transparent" };
    if (mode === "exact" || exact.status === "nothing-to-remove") {
      return { png: asPng, method: "none", note: exact.status === "not-uniform" ? "Background isn't one solid color — try AI cleanup." : "No background found to remove." };
    }
    if (!process.env.OPENAI_API_KEY) return { png: asPng, method: "none", note: "Background isn't one solid color and AI cleanup isn't set up." };
  }
  const { aiCutout } = await import("./openai-cutout");
  // Keep the request reasonable: the edit model works at ~1–1.5k px anyway.
  const small = await sharp(asPng).resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return { png: await aiCutout(small), method: "ai", note: "AI cleanup — check the details against the original." };
}
