// ---------------------------------------------------------------------------
// Live-designer realism (customer designers): shade a piece of artwork by the
// garment photo underneath it, the same idea as the admin Garment Mockup
// tool's renderMockup (lib/garment-mockup.ts) — folds, seams and texture show
// through the logo instead of it looking pasted on. Runs in the browser on
// same-origin images (/api/product-image proxy + blob: artwork URLs).
// ---------------------------------------------------------------------------

type Pixels = { data: Uint8ClampedArray; w: number; h: number };
const garmentCache = new Map<string, Promise<Pixels | null>>();
const artCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function garmentPixels(src: string): Promise<Pixels | null> {
  let p = garmentCache.get(src);
  if (!p) {
    p = loadImg(src).then((img) => {
      if (!img || !img.naturalWidth) return null;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      try {
        return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
      } catch {
        return null; // cross-origin image — can't read pixels; show artwork unshaded
      }
    });
    garmentCache.set(src, p);
  }
  return p;
}

// Customers often upload a logo on a white box (JPG). For the on-garment
// preview only, a plain solid background is cut away (lib/bg-remove.ts — the
// artwork itself isn't changed); the uploaded file is kept as-is for the order.
const cleanCache = new Map<string, Promise<string>>();
export function cleanArtworkUrl(src: string): Promise<string> {
  let p = cleanCache.get(src);
  if (!p) {
    p = import("./bg-remove-browser")
      .then(({ cutoutImageInBrowser }) => cutoutImageInBrowser(src))
      .then((r) => (r.status === "removed" && r.url ? r.url : src))
      .catch(() => src);
    cleanCache.set(src, p);
  }
  return p;
}

export function artworkImage(src: string) {
  let p = artCache.get(src);
  if (!p) {
    p = cleanArtworkUrl(src).then(loadImg);
    artCache.set(src, p);
  }
  return p;
}

export type ShadeInput = {
  artSrc: string;
  garmentSrc: string;
  box: { x: number; y: number; width: number; height: number }; // % of the container
  containerPx: number; // container width = height (square canvas)
  insetPx: number; // padding between the container edge and the garment photo
  strength?: number; // 0-100, default 60 (how much fabric shows through)
};

/** Returns an object URL of the shaded artwork (sized to the box), or null if it can't be shaded. */
export async function shadeArtwork(input: ShadeInput): Promise<string | null> {
  const [garment, art] = await Promise.all([garmentPixels(input.garmentSrc), artworkImage(input.artSrc)]);
  if (!garment || !art || !art.naturalWidth) return null;
  const { box, containerPx, insetPx } = input;
  const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const boxW = (box.width / 100) * containerPx;
  const boxH = (box.height / 100) * containerPx;
  if (boxW < 4 || boxH < 4) return null;
  const scaleOut = Math.min(dpr, 900 / Math.max(boxW, boxH));
  const W = Math.max(1, Math.round(boxW * scaleOut));
  const H = Math.max(1, Math.round(boxH * scaleOut));

  // Draw the artwork object-contain inside the box, like the <img> does.
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const a = art.naturalWidth / art.naturalHeight;
  let dw = W, dh = W / a;
  if (dh > H) {
    dh = H;
    dw = H * a;
  }
  const dx = (W - dw) / 2, dy = (H - dh) / 2;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(art, dx, dy, dw, dh);
  const out = ctx.getImageData(0, 0, W, H);
  const lp = out.data;

  // Map box pixels to garment-photo pixels (photo drawn object-contain in the
  // square content area inside insetPx).
  const content = Math.max(1, containerPx - insetPx * 2);
  const gScale = Math.max(garment.w, garment.h) / content;
  const offX = (content - garment.w / gScale) / 2 + insetPx;
  const offY = (content - garment.h / gScale) / 2 + insetPx;
  const boxLeft = (box.x / 100) * containerPx;
  const boxTop = (box.y / 100) * containerPx;
  const lum = (i: number) => 0.299 * garment.data[i] + 0.587 * garment.data[i + 1] + 0.114 * garment.data[i + 2];
  const gIndex = (px: number, py: number) => {
    const gx = Math.floor((boxLeft + px / scaleOut - offX) * gScale);
    const gy = Math.floor((boxTop + py / scaleOut - offY) * gScale);
    if (gx < 0 || gy < 0 || gx >= garment.w || gy >= garment.h) return -1;
    return (gy * garment.w + gx) * 4;
  };

  // Average garment brightness under the artwork.
  let sum = 0, n = 0;
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x += 3) {
      if (lp[(y * W + x) * 4 + 3] === 0) continue;
      const gi = gIndex(x, y);
      if (gi < 0) continue;
      sum += lum(gi);
      n++;
    }
  }
  if (!n) return null;
  const mean = Math.max(1, sum / n);
  const k = ((input.strength ?? 60) / 100) * 1.2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const li = (y * W + x) * 4;
      if (lp[li + 3] === 0) continue;
      const gi = gIndex(x, y);
      if (gi < 0) continue;
      const f = Math.min(1.3, Math.max(0.55, 1 + (lum(gi) / mean - 1) * k));
      const lift = f > 1 ? (f - 1) * 40 : 0;
      lp[li] = Math.min(255, lp[li] * f + lift);
      lp[li + 1] = Math.min(255, lp[li + 1] * f + lift);
      lp[li + 2] = Math.min(255, lp[li + 2] * f + lift);
    }
  }
  ctx.putImageData(out, 0, 0);
  return new Promise((resolve) => c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), "image/png"));
}

// ---- Resolution check -------------------------------------------------------

/** Rough real-world width of the whole preview canvas, by product type. */
export function canvasWidthInches(productType: string): number {
  return productType === "hat" ? 9 : 28;
}

export type ArtworkResolution = { dpi: number; inches: number; level: "good" | "fair" | "low" };

export function assessArtworkResolution(pxWidth: number, boxWidthPct: number, productType: string): ArtworkResolution {
  const inches = Math.max(0.5, (boxWidthPct / 100) * canvasWidthInches(productType));
  const dpi = Math.round(pxWidth / inches);
  return { dpi, inches, level: dpi >= 300 ? "good" : dpi >= 150 ? "fair" : "low" };
}

/** True for file types we can measure in pixels (vector files print sharp at any size). */
export function isRasterArtwork(fileName?: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp|heic|tiff?)$/i.test(fileName ?? "");
}
