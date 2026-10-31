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
};

const GARMENT_PRESETS: PlacementPreset[] = [
  {
    id: "left-chest",
    label: "Left Chest",
    hint: "≈ 3.5–4.5″ wide, over the heart",
    view: "front",
    centerX: 0.64,
    centerY: 0.267,
    maxWidth: 0.125,
    maxHeight: 0.09,
  },
  {
    id: "full-front",
    label: "Full Front",
    hint: "≈ 10–12″ wide, centered on the chest",
    view: "front",
    centerX: 0.5,
    centerY: 0.4,
    maxWidth: 0.36,
    maxHeight: 0.36,
  },
  {
    id: "back",
    label: "Back",
    hint: "≈ 11–12″ wide, centered below the collar",
    view: "back",
    centerX: 0.5,
    centerY: 0.37,
    maxWidth: 0.38,
    maxHeight: 0.42,
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

// Composite the logo onto the garment photo at the photo's native size.
export function renderMockup(
  base: HTMLImageElement,
  logo: HTMLCanvasElement,
  layout: LogoLayout,
  opts: RenderOptions
): HTMLCanvasElement {
  const W = base.naturalWidth;
  const H = base.naturalHeight;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(base, 0, 0);

  const lx = Math.round(layout.x);
  const ly = Math.round(layout.y);
  const lw = Math.max(1, Math.round(layout.width));
  const lh = Math.max(1, Math.round(layout.height));

  // Scaled logo on its own layer.
  const layer = document.createElement("canvas");
  layer.width = lw;
  layer.height = lh;
  const lctx = layer.getContext("2d", { willReadFrequently: true })!;
  lctx.imageSmoothingQuality = "high";
  lctx.drawImage(logo, 0, 0, lw, lh);

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
