// ---------------------------------------------------------------------------
// Custom Hat Mockup Generator — shared canvas rendering utilities (phase 2)
// ---------------------------------------------------------------------------
// Plain HTML5 Canvas 2D helpers shared by the embroidery/engraving/UV/banner
// engines. No WebGL, no server-side image processing, no AI image
// generation — everything here is deterministic. See the phase-2 spec for
// the reasoning behind each function.
// ---------------------------------------------------------------------------

import { PatchShape } from "@/lib/mockup-types";

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err instanceof Event ? new Error(`Failed to load image: ${url}`) : err);
    img.src = url;
  });
}

// Returns true if a canvas that has had `img` drawn onto it can have its
// pixel data read back (getImageData) without throwing a SecurityError.
// Hat photos come from a third-party CDN (cdnm.sanmar.com) that may not send
// permissive CORS headers even though we requested crossOrigin="anonymous";
// in that case the canvas becomes "tainted" and getImageData throws. The
// customer's own uploaded artwork is always a same-origin object URL, so
// this check is only ever needed for hat photos.
export function canReadPixels(canvas: HTMLCanvasElement): boolean {
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export { makeCanvas };

// ---------------------------------------------------------------------------
// Shape paths
// ---------------------------------------------------------------------------

// Manual rounded-rect path (arcs), since Path2D.roundRect isn't guaranteed
// to exist in every target environment.
function roundedRectPath(w: number, h: number, radius: number): Path2D {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  const p = new Path2D();
  p.moveTo(r, 0);
  p.lineTo(w - r, 0);
  p.arcTo(w, 0, w, r, r);
  p.lineTo(w, h - r);
  p.arcTo(w, h, w - r, h, r);
  p.lineTo(r, h);
  p.arcTo(0, h, 0, h - r, r);
  p.lineTo(0, r);
  p.arcTo(0, 0, r, 0, r);
  p.closePath();
  return p;
}

function hexagonPath(w: number, h: number): Path2D {
  // Flat-top hexagon inscribed in the box.
  const p = new Path2D();
  const inset = w * 0.25;
  p.moveTo(inset, 0);
  p.lineTo(w - inset, 0);
  p.lineTo(w, h / 2);
  p.lineTo(w - inset, h);
  p.lineTo(inset, h);
  p.lineTo(0, h / 2);
  p.closePath();
  return p;
}

function shieldPath(w: number, h: number): Path2D {
  // Rounded-top / pointed-bottom shield — a believable approximation.
  const p = new Path2D();
  const topRadius = w * 0.5;
  p.moveTo(0, h * 0.22);
  p.arcTo(0, 0, topRadius, 0, topRadius);
  p.arcTo(w, 0, w, h * 0.22, topRadius);
  p.lineTo(w, h * 0.55);
  p.quadraticCurveTo(w, h * 0.8, w / 2, h);
  p.quadraticCurveTo(0, h * 0.8, 0, h * 0.55);
  p.closePath();
  return p;
}

// Measures the bounding box of an SVG path string by stroking/filling it on
// a throwaway canvas at a generous scale, so a custom svgPath (assumed
// authored in a 0-100 viewBox) can be scaled to fit widthPx x heightPx.
function svgPathBBox(d: string): { x: number; y: number; width: number; height: number } {
  const probe = makeCanvas(400, 400);
  const ctx = probe.getContext("2d")!;
  // Draw at a 4x scale (0-100 viewBox -> 400px) so bbox measurement below
  // has decent resolution, then convert back to viewBox units.
  ctx.save();
  ctx.scale(4, 4);
  const path = new Path2D(d);
  ctx.fillStyle = "#000";
  ctx.fill(path);
  ctx.restore();

  const data = ctx.getImageData(0, 0, 400, 400).data;
  let minX = 400, minY = 400, maxX = 0, maxY = 0;
  let found = false;
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 400; x++) {
      const alpha = data[(y * 400 + x) * 4 + 3];
      if (alpha > 10) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return { x: 0, y: 0, width: 100, height: 100 };
  return { x: minX / 4, y: minY / 4, width: (maxX - minX) / 4, height: (maxY - minY) / 4 };
}

export function buildShapePath2D(
  shape: PatchShape,
  widthPx: number,
  heightPx: number
): Path2D {
  if (shape.svgPath) {
    const bbox = svgPathBBox(shape.svgPath);
    const bw = bbox.width || 100;
    const bh = bbox.height || 100;
    const scaleX = widthPx / bw;
    const scaleY = heightPx / bh;
    const raw = new Path2D(shape.svgPath);
    const transformed = new Path2D();
    const m = new DOMMatrix()
      .scale(scaleX, scaleY)
      .translate(-bbox.x, -bbox.y);
    transformed.addPath(raw, m);
    return transformed;
  }

  const cornerPct = shape.cornerRadiusPct ?? 18;

  switch (shape.geometry) {
    case "rectangle":
      return roundedRectPath(widthPx, heightPx, 0);
    case "roundedRectangle": {
      const radius = (Math.min(widthPx, heightPx) * cornerPct) / 100;
      return roundedRectPath(widthPx, heightPx, radius);
    }
    case "square": {
      const side = Math.min(widthPx, heightPx);
      const ox = (widthPx - side) / 2;
      const oy = (heightPx - side) / 2;
      const p = new Path2D();
      const local = roundedRectPath(side, side, 0);
      const m = new DOMMatrix().translate(ox, oy);
      p.addPath(local, m);
      return p;
    }
    case "roundedSquare": {
      const side = Math.min(widthPx, heightPx);
      const ox = (widthPx - side) / 2;
      const oy = (heightPx - side) / 2;
      const radius = (side * cornerPct) / 100;
      const local = roundedRectPath(side, side, radius);
      const p = new Path2D();
      const m = new DOMMatrix().translate(ox, oy);
      p.addPath(local, m);
      return p;
    }
    case "circle": {
      const r = Math.min(widthPx, heightPx) / 2;
      const p = new Path2D();
      p.ellipse(widthPx / 2, heightPx / 2, r, r, 0, 0, Math.PI * 2);
      return p;
    }
    case "oval": {
      const p = new Path2D();
      p.ellipse(widthPx / 2, heightPx / 2, widthPx / 2, heightPx / 2, 0, 0, Math.PI * 2);
      return p;
    }
    case "hexagon":
      return hexagonPath(widthPx, heightPx);
    case "shield":
      return shieldPath(widthPx, heightPx);
    default:
      return roundedRectPath(widthPx, heightPx, 0);
  }
}

// ---------------------------------------------------------------------------
// Leatherette texture
// ---------------------------------------------------------------------------

export function generateLeatheretteTexture(
  widthPx: number,
  heightPx: number,
  textureStrength: number,
  baseColorHex: string
): HTMLCanvasElement {
  const canvas = makeCanvas(widthPx, heightPx);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = baseColorHex;
  ctx.fillRect(0, 0, widthPx, heightPx);

  const strength = Math.max(0, Math.min(100, textureStrength)) / 100;
  const area = widthPx * heightPx;
  const speckleCount = Math.min(4000, Math.round((area / 40) * strength));
  const maxOpacity = 0.08 + strength * 0.32;

  for (let i = 0; i < speckleCount; i++) {
    const x = Math.random() * widthPx;
    const y = Math.random() * heightPx;
    const radius = 0.4 + Math.random() * 1.6;
    const dark = Math.random() < 0.5;
    const opacity = Math.random() * maxOpacity;
    ctx.beginPath();
    ctx.fillStyle = dark
      ? `rgba(0,0,0,${opacity.toFixed(3)})`
      : `rgba(255,255,255,${opacity.toFixed(3)})`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// Dominant color extraction
// ---------------------------------------------------------------------------

export function extractDominantColors(img: HTMLImageElement, maxColors = 3): string[] {
  const size = 64;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  // Contain the image within the sample canvas so aspect ratio doesn't
  // distort sampling.
  const scale = Math.min(size / img.width, size / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    // Tainted canvas (CORS) — nothing we can do, return an empty result so
    // callers fall back to their own defaults.
    return [];
  }

  const bucket = (v: number) => Math.min(255, Math.round(v / 32) * 32);

  const tally = (excludeExtremes: boolean): Map<string, number> => {
    const counts = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 128) continue;
      if (excludeExtremes) {
        const isNearWhite = r > 235 && g > 235 && b > 235;
        const isNearBlack = r < 20 && g < 20 && b < 20;
        if (isNearWhite || isNearBlack) continue;
      }
      const key = `${bucket(r)},${bucket(g)},${bucket(b)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };

  let counts = tally(true);
  if (counts.size === 0) {
    // All-black or all-white logo (or fully excluded) — fall back to
    // including the extremes so we still return something.
    counts = tally(false);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, maxColors).map(([key]) => {
    const [r, g, b] = key.split(",").map(Number);
    return rgbToHex(r, g, b);
  });
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// ---------------------------------------------------------------------------
// WCAG contrast
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Perspective / curvature warp
// ---------------------------------------------------------------------------

// Subdivides sourceCanvas into thin vertical strips and draws each into a
// destination quad approximated as an affine transform (no true homography —
// intentionally, per spec: strips are thin enough that an affine
// approximation is visually indistinguishable at "subtle" warp amounts).
export function meshWarpPerspective(
  sourceCanvas: HTMLCanvasElement,
  destCtx: CanvasRenderingContext2D,
  destX: number,
  destY: number,
  destWidth: number,
  destHeight: number,
  tiltDeg: number,
  bulgePct: number
): void {
  if (!tiltDeg && !bulgePct) {
    destCtx.drawImage(sourceCanvas, destX, destY, destWidth, destHeight);
    return;
  }

  const N = 12;
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const stripSrcW = sw / N;
  const tilt = (tiltDeg * Math.PI) / 180;
  const bulge = Math.max(0, Math.min(100, bulgePct)) / 100;

  // Max horizontal foreshortening at the far edge (linear taper across
  // strips), expressed as a fraction of destHeight.
  const maxTaper = Math.tan(Math.max(-1.2, Math.min(1.2, tilt))) * destHeight * 0.5;
  // Bulge amount: strips near the horizontal center project slightly larger
  // (barrel curvature), via a sine curve across strip index.
  const maxBulge = bulge * destHeight * 0.18;

  destCtx.save();
  for (let i = 0; i < N; i++) {
    const sx = i * stripSrcW;
    const t0 = i / N; // 0..1 across strips
    const t1 = (i + 1) / N;
    const centerT0 = t0 - 0.5;
    const centerT1 = t1 - 0.5;

    // Linear taper: left edge tapers one way, right edge the other,
    // simulating a front panel receding to one side.
    const taper0 = maxTaper * (t0 * 2 - 1);
    const taper1 = maxTaper * (t1 * 2 - 1);

    // Sine bulge: peaks at the horizontal center (t=0.5).
    const bulge0 = maxBulge * Math.cos(centerT0 * Math.PI);
    const bulge1 = maxBulge * Math.cos(centerT1 * Math.PI);

    const dx0 = destX + t0 * destWidth;
    const dx1 = destX + t1 * destWidth;
    const topY0 = destY - bulge0 * 0.5 + taper0 * 0.15;
    const topY1 = destY - bulge1 * 0.5 + taper1 * 0.15;
    const bottomY0 = destY + destHeight + bulge0 * 0.5 - taper0 * 0.15;
    const bottomY1 = destY + destHeight + bulge1 * 0.5 - taper1 * 0.15;

    // Affine transform mapping the source strip's axis-aligned rect
    // (sx,0)-(sx+stripSrcW, sh) to the destination quad approximated by
    // its left edge (topY0->bottomY0 at dx0) and width dx1-dx0.
    const destStripW = dx1 - dx0;
    const destStripH0 = bottomY0 - topY0;
    const destStripH1 = bottomY1 - topY1;
    const avgH = (destStripH0 + destStripH1) / 2;

    destCtx.save();
    destCtx.beginPath();
    destCtx.moveTo(dx0, topY0);
    destCtx.lineTo(dx1, topY1);
    destCtx.lineTo(dx1, bottomY1);
    destCtx.lineTo(dx0, bottomY0);
    destCtx.closePath();
    destCtx.clip();

    // Map source strip origin/scale to dest quad's top-left, with a slight
    // shear to account for the top edge's differing y. Note: this must be
    // composed onto the *existing* transform with ctx.transform(), not
    // ctx.setTransform() — the caller may already have a device-pixel-ratio
    // / export-resolution scale applied (composeMockup calls
    // ctx.scale(multiplier, multiplier) for high-res export), and
    // setTransform() would silently overwrite that outer scale, drawing the
    // warped patch at the wrong size and position.
    const scaleX = destStripW / stripSrcW;
    const scaleY = avgH / sh;
    const b = (topY1 - topY0) / stripSrcW;
    const e = dx0 - sx * scaleX;
    const f = topY0 - b * sx;
    destCtx.transform(scaleX, b, 0, scaleY, e, f);
    destCtx.drawImage(sourceCanvas, 0, 0);
    destCtx.restore();
  }
  destCtx.restore();
}
