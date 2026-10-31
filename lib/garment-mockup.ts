// ---------------------------------------------------------------------------
// Garment Mockup Tool — placement math + canvas rendering (browser only)
// ---------------------------------------------------------------------------
// Takes a blank garment photo (uploaded, or a SanMar/custom catalog photo
// from this site), a logo (usually a transparent PNG) and a placement
// (Left Chest / Full Front / Back, or hat placements), and composites the
// logo onto the garment at full photo resolution.
//
// Placement is relative to the garment's own bounding box (detected by
// comparing pixels against the photo's background color), not the whole
// photo, so it lands in the right spot regardless of how much white space
// surrounds the garment. The Left Chest preset is calibrated against a
// real JM Media proof (Port Authority W961 + left-chest embroidery).
// ---------------------------------------------------------------------------

import type { ProductType } from "./types";

export type PlacementId = "left-chest" | "full-front" | "back" | "hat-front" | "hat-left-side";

export type PlacementPreset = {
  id: PlacementId;
  label: string;
  hint: string;
  view: "front" | "back";
  // All fractions of the detected garment bounding box.
  centerX: number;
  centerY: number;
  maxWidth: number;
  maxHeight: number;
  // Real-world print width (inches) when a logo fills the full placement
  // width at 100% size — used to estimate the logo's effective dpi.
  nominalWidthIn: number;
};

const GARMENT_PRESETS: PlacementPreset[] = [
  {
    id: "left-chest",
    label: "Left Chest",
    hint: "about 3.5-4.5 in wide, over the heart",
    view: "front",
    centerX: 0.64,
    centerY: 0.267,
    maxWidth: 0.125,
    maxHeight: 0.09,
    nominalWidthIn: 4,
  },
  {
    id: "full-front",
    label: "Full Front",
    hint: "about 10-12 in wide, centered on the chest",
    view: "front",
    centerX: 0.5,
    centerY: 0.4,
    maxWidth: 0.36,
    maxHeight: 0.36,
    nominalWidthIn: 11,
  },
  {
    id: "back",
    label: "Back",
    hint: "about 11-12 in wide, centered below the collar",
    view: "back",
    centerX: 0.5,
    centerY: 0.37,
    maxWidth: 0.38,
    maxHeight: 0.42,
    nominalWidthIn: 12,
  },
];

const HAT_PRESETS: PlacementPreset[] = [
  {
    id: "hat-front",
    label: "Front Center",
    hint: "Centered on the front panels",
    view: "front",
    centerX: 0.5,
    centerY: 0.36,
    maxWidth: 0.36,
    maxHeight: 0.24,
    nominalWidthIn: 4.5,
  },
  {
    id: "hat-left-side",
    label: "Left Side",
    hint: "Small mark on the side panel",
    view: "front",
    centerX: 0.25,
    centerY: 0.42,
    maxWidth: 0.14,
    maxHeight: 0.12,
    nominalWidthIn: 2,
  },
  {
    id: "back",
    label: "Back",
    hint: "Above the closure",
    view: "back",
    centerX: 0.5,
    centerY: 0.4,
    maxWidth: 0.28,
    maxHeight: 0.14,
    nominalWidthIn: 2.5,
  },
];

export function presetsFor(productType: ProductType | "upload-hat" | "upload-garment"): PlacementPreset[] {
  return productType === "hat" || productType === "upload-hat" ? HAT_PRESETS : GARMENT_PRESETS;
}

export type Rect = { x: number; y: number; width: number; height: number };

// Logo layout in base-image pixel space.
export type LogoLayout = Rect;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load image`));
    img.src = src;
  });
}

function getPixels(img: CanvasImageSource, w: number, h: number): ImageData {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// Find the garment inside the photo: anything that differs noticeably from
// the background (sampled from the four corners) or is non-transparent.
export function detectGarmentBounds(img: HTMLImageElement): Rect {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const scale = Math.min(1, 600 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  const { data } = getPixels(img, w, h);

  const corner = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const corners = [corner(1, 1), corner(w - 2, 1), corner(1, h - 2), corner(w - 2, h - 2)];
  const bg = [0, 1, 2, 3].map((k) => corners.reduce((s, c) => s + c[k], 0) / 4);
  const transparentBg = bg[3] < 128;

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      const isGarment = transparentBg
        ? a > 40
        : a > 40 &&
          Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 30;
      if (isGarment) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width: W, height: H };
  return {
    x: minX / scale,
    y: minY / scale,
    width: (maxX - minX + 1) / scale,
    height: (maxY - minY + 1) / scale,
  };
}

// On-model photos (SanMar's fallback when a style has no flat photo): the
// detected bounds are the whole person, so estimate the shirt as the band
// between the shoulders and the waist. Approximate — the user can drag.
export function onModelGarmentBounds(person: Rect): Rect {
  return {
    x: person.x + person.width * 0.04,
    y: person.y + person.height * 0.21,
    width: person.width * 0.92,
    height: person.height * 0.47,
  };
}

// Crop away fully transparent padding around a logo so sizing is based on
// the artwork itself, not the PNG canvas.
export function trimTransparent(img: HTMLImageElement): HTMLCanvasElement {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const { data } = getPixels(img, W, H);
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const out = document.createElement("canvas");
  if (maxX < 0) {
    out.width = W;
    out.height = H;
    out.getContext("2d")!.drawImage(img, 0, 0);
    return out;
  }
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext("2d")!.drawImage(img, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export function layoutForPreset(
  preset: PlacementPreset,
  garment: Rect,
  logoW: number,
  logoH: number,
  sizePct = 100
): LogoLayout {
  const boxW = garment.width * preset.maxWidth;
  const boxH = garment.height * preset.maxHeight;
  const fit = Math.min(boxW / logoW, boxH / logoH) * (sizePct / 100);
  const width = logoW * fit;
  const height = logoH * fit;
  const cx = garment.x + garment.width * preset.centerX;
  const cy = garment.y + garment.height * preset.centerY;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

export type RenderOptions = {
  fabricBlend: number; // 0-100: how much the garment's folds/shading show through the logo
  raised: boolean; // subtle drop shadow, reads as embroidery/patch
};

// Mockups are exported at least this many px on the long side. Supplier
// photos often arrive at ~1000px, which would leave a left-chest logo only
// ~80px wide — too few pixels for it to look crisp, however sharp the art is.
const MIN_EXPORT_LONG_SIDE = 3000;
const MAX_EXPORT_SCALE = 4;

export function exportScaleFor(base: HTMLImageElement): number {
  const long = Math.max(base.naturalWidth, base.naturalHeight);
  return Math.min(MAX_EXPORT_SCALE, Math.max(1, MIN_EXPORT_LONG_SIDE / long));
}

// High-quality downscale: halve repeatedly, then a final resize. A single
// big drawImage() shrink (e.g. 1800px -> 120px) skips most source pixels and
// leaves jagged, stair-stepped edges.
export function resizeHQ(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur: HTMLCanvasElement = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const half = document.createElement("canvas");
    half.width = Math.max(1, Math.round(cur.width / 2));
    half.height = Math.max(1, Math.round(cur.height / 2));
    const hctx = half.getContext("2d")!;
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d", { willReadFrequently: true })!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(cur, 0, 0, w, h);
  return out;
}

// ---- logo resolution --------------------------------------------------------

// The dpi a file is *tagged* with (PNG pHYs / JPEG JFIF density). Only
// metadata — what actually matters is pixels per inch at the print size,
// see assessResolution().
export function readTaggedDpi(buf: ArrayBuffer): number | null {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  // PNG
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    let off = 8;
    while (off + 12 <= b.length) {
      const len = dv.getUint32(off);
      const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
      if (type === "pHYs" && len >= 9) {
        const ppuX = dv.getUint32(off + 8);
        const unit = b[off + 16];
        return unit === 1 ? Math.round(ppuX * 0.0254) : null;
      }
      if (type === "IDAT" || type === "IEND") return null;
      off += 12 + len;
    }
    return null;
  }
  // JPEG (JFIF APP0)
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let off = 2;
    while (off + 4 < b.length && b[off] === 0xff) {
      const marker = b[off + 1];
      const len = dv.getUint16(off + 2);
      if (marker === 0xe0 && String.fromCharCode(...b.slice(off + 4, off + 8)) === "JFIF") {
        const units = b[off + 11];
        const xd = dv.getUint16(off + 12);
        if (units === 1) return xd;
        if (units === 2) return Math.round(xd * 2.54);
        return null;
      }
      if (marker === 0xda) break;
      off += 2 + len;
    }
  }
  return null;
}

export type ResolutionLevel = "good" | "fair" | "low";
export const RECOMMENDED_DPI = 300;
export const LOW_DPI = 150;

export function assessResolution(logoPxWidth: number, printWidthIn: number) {
  const dpi = Math.round(logoPxWidth / Math.max(0.1, printWidthIn));
  const level: ResolutionLevel = dpi >= RECOMMENDED_DPI ? "good" : dpi >= LOW_DPI ? "fair" : "low";
  return { dpi, level };
}

// Estimated real-world width (inches) of a placed logo.
export function printWidthIn(
  preset: PlacementPreset,
  garment: Rect,
  layout: LogoLayout
): number {
  return (layout.width / (garment.width * preset.maxWidth)) * preset.nominalWidthIn;
}

// Composite the logo onto the garment photo. Output is upscaled so the long
// side is at least MIN_EXPORT_LONG_SIDE px; `layout` stays in base-photo px.
export function renderMockup(
  base: HTMLImageElement,
  logo: HTMLCanvasElement,
  layout: LogoLayout,
  opts: RenderOptions
): HTMLCanvasElement {
  const k = exportScaleFor(base);
  const W = Math.round(base.naturalWidth * k);
  const H = Math.round(base.naturalHeight * k);
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(base, 0, 0, W, H);

  const lx = Math.round(layout.x * k);
  const ly = Math.round(layout.y * k);
  const lw = Math.max(1, Math.round(layout.width * k));
  const lh = Math.max(1, Math.round(layout.height * k));

  // Scaled logo on its own layer.
  const layer = resizeHQ(logo, lw, lh);
  const lctx = layer.getContext("2d", { willReadFrequently: true })!;

  // Fabric shading: modulate the logo by the garment's local brightness
  // relative to its average under the logo, so folds and seams carry
  // through the artwork instead of it looking pasted on.
  if (opts.fabricBlend > 0) {
    const sx = Math.max(0, lx), sy = Math.max(0, ly);
    const ex = Math.min(W, lx + lw), ey = Math.min(H, ly + lh);
    if (ex > sx && ey > sy) {
      const garmentPx = ctx.getImageData(sx, sy, ex - sx, ey - sy).data;
      const logoData = lctx.getImageData(0, 0, lw, lh);
      const lp = logoData.data;
      const gw = ex - sx;
      let sum = 0, n = 0;
      for (let i = 0; i < garmentPx.length; i += 4) {
        sum += 0.299 * garmentPx[i] + 0.587 * garmentPx[i + 1] + 0.114 * garmentPx[i + 2];
        n++;
      }
      const mean = Math.max(1, sum / n);
      const k = (opts.fabricBlend / 100) * 1.2;
      for (let y = sy; y < ey; y++) {
        for (let x = sx; x < ex; x++) {
          const gi = ((y - sy) * gw + (x - sx)) * 4;
          const li = ((y - ly) * lw + (x - lx)) * 4;
          if (lp[li + 3] === 0) continue;
          const L = 0.299 * garmentPx[gi] + 0.587 * garmentPx[gi + 1] + 0.114 * garmentPx[gi + 2];
          const f = Math.min(1.3, Math.max(0.55, 1 + (L / mean - 1) * k));
          lp[li] = Math.min(255, lp[li] * f + (f > 1 ? (f - 1) * 40 : 0));
          lp[li + 1] = Math.min(255, lp[li + 1] * f + (f > 1 ? (f - 1) * 40 : 0));
          lp[li + 2] = Math.min(255, lp[li + 2] * f + (f > 1 ? (f - 1) * 40 : 0));
        }
      }
      lctx.putImageData(logoData, 0, 0);
    }
  }

  if (opts.raised) {
    const blur = Math.max(1, Math.round(Math.min(W, H) / 900));
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = blur * 2;
    ctx.shadowOffsetX = blur * 0.6;
    ctx.shadowOffsetY = blur;
    ctx.drawImage(layer, lx, ly);
    ctx.restore();
  } else {
    ctx.drawImage(layer, lx, ly);
  }
  return out;
}
