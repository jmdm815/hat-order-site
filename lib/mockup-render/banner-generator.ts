// ---------------------------------------------------------------------------
// Custom Hat Mockup Generator — decoration-method banner generator
// (phase 2)
// ---------------------------------------------------------------------------

import { MockupDecorationMethod, PatchMaterial } from "@/lib/mockup-types";
import {
  buildShapePath2D,
  contrastRatio,
  extractDominantColors,
  generateLeatheretteTexture,
  makeCanvas,
  relativeLuminance,
} from "./canvas-utils";

export type GenerateBannerOpts = {
  widthPx: number;
  heightPx: number;
  method: MockupDecorationMethod;
  artwork: HTMLImageElement;
  material?: PatchMaterial;
};

const METHOD_LABEL: Record<MockupDecorationMethod, string> = {
  embroidered: "EMBROIDERED HAT",
  engraved: "ENGRAVED PATCH",
  uv: "UV PRINTED PATCH",
};

const SAFE_DARK = "#1a1a1a";
const SAFE_LIGHT = "#ffffff";

function pickTextColor(background: string, preferred: string): string {
  if (contrastRatio(preferred, background) >= 3.0) return preferred;
  const whiteContrast = contrastRatio(SAFE_LIGHT, background);
  const blackContrast = contrastRatio(SAFE_DARK, background);
  return whiteContrast >= blackContrast ? SAFE_LIGHT : SAFE_DARK;
}

function pickScheme(
  method: MockupDecorationMethod,
  dominant: string[],
  material?: PatchMaterial
): { background: string; border: string; text: string } {
  if (method === "engraved" && material) {
    const background = material.surfaceColorHex;
    const border = material.engravingColorHex;
    const text = pickTextColor(background, material.engravingColorHex);
    return { background, border, text };
  }

  if (method === "uv") {
    const sorted = [...dominant].sort((a, b) => relativeLuminance(b) - relativeLuminance(a));
    const lightest = sorted[0];
    const background = lightest && relativeLuminance(lightest) > 0.55 ? lightest : "#f7f7f5";
    const border = pickMostSaturated(dominant) ?? (material?.engravingColorHex ?? "#8a8a8a");
    const darkest = sorted[sorted.length - 1];
    const text = pickTextColor(background, darkest ?? SAFE_DARK);
    return { background, border, text };
  }

  // embroidered
  const sortedByLum = [...dominant].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
  let background = sortedByLum[0];
  if (!background || relativeLuminance(background) > 0.5) {
    background = "#1a1a1a";
  }
  const remaining = dominant.filter((c) => c !== background);
  const border = pickMostSaturated(remaining) ?? "#3a6b3a";
  const lightest = sortedByLum[sortedByLum.length - 1];
  const textCandidate = lightest && contrastRatio(lightest, background) > contrastRatio(SAFE_LIGHT, background)
    ? lightest
    : SAFE_LIGHT;
  const text = pickTextColor(background, textCandidate);
  return { background, border, text };
}

function pickMostSaturated(colors: string[]): string | null {
  if (colors.length === 0) return null;
  let best = colors[0];
  let bestSat = -1;
  for (const c of colors) {
    const sat = saturation(c);
    if (sat > bestSat) {
      bestSat = sat;
      best = c;
    }
  }
  return best;
}

function saturation(hex: string): number {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  startSize: number,
  maxWidth: number,
  fontWeight = "800"
): number {
  let size = startSize;
  while (size > 6) {
    ctx.font = `${fontWeight} ${size}px system-ui, -apple-system, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

function buildStitchTilePattern(ctx: CanvasRenderingContext2D, opacity: number): CanvasPattern {
  const tile = makeCanvas(8, 8);
  const tctx = tile.getContext("2d")!;
  tctx.strokeStyle = `rgba(255,255,255,${opacity.toFixed(3)})`;
  tctx.lineWidth = 1.5;
  tctx.beginPath();
  tctx.moveTo(-2, 10);
  tctx.lineTo(10, -2);
  tctx.stroke();
  return ctx.createPattern(tile, "repeat")!;
}

export function generateBanner(opts: GenerateBannerOpts): HTMLCanvasElement {
  const { widthPx, heightPx, method, artwork, material } = opts;
  const w = Math.round(widthPx);
  const h = Math.round(heightPx);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;

  // 1. Dominant colors from the artwork.
  const dominant = extractDominantColors(artwork, 3);

  // 2 + 3. Per-method scheme + contrast guarantee.
  const scheme = pickScheme(method, dominant, material);

  // 4. Rounded-rect chip.
  const path = buildShapePath2D(
    { id: "banner-chip", name: "chip", geometry: "roundedRectangle", cornerRadiusPct: 30, availableForEngraving: true, availableForUv: true, active: true, sortOrder: 0 },
    w,
    h
  );

  // Method-specific texture flourish on the background, drawn before the
  // fill/border/text so it never covers them.
  if (method === "engraved") {
    ctx.save();
    ctx.clip(path);
    const texture = generateLeatheretteTexture(w, h, material?.textureStrength ?? 50, scheme.background);
    ctx.drawImage(texture, 0, 0);
    ctx.restore();
  } else {
    ctx.fillStyle = scheme.background;
    ctx.fill(path);
  }

  if (method === "uv") {
    ctx.save();
    ctx.clip(path);
    const angle = (20 * Math.PI) / 180;
    const gradient = ctx.createLinearGradient(0, 0, w * Math.cos(angle), h * Math.sin(angle));
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.12)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // Border.
  const borderWidth = Math.max(2, Math.min(w, h) * 0.04);
  ctx.save();
  ctx.lineWidth = borderWidth;
  ctx.strokeStyle = scheme.border;
  ctx.stroke(path);
  ctx.restore();

  // Thin horizontal accent lines inset from each side edge.
  const accentInset = w * 0.06;
  const accentY = h / 2;
  const accentLen = w * 0.08;
  ctx.save();
  ctx.strokeStyle = scheme.border;
  ctx.lineWidth = Math.max(1, borderWidth * 0.4);
  ctx.beginPath();
  ctx.moveTo(accentInset, accentY);
  ctx.lineTo(accentInset + accentLen, accentY);
  ctx.moveTo(w - accentInset, accentY);
  ctx.lineTo(w - accentInset - accentLen, accentY);
  ctx.stroke();
  ctx.restore();

  // Bold centered text, auto-sized to fit.
  const label = METHOD_LABEL[method];
  const maxTextWidth = w * 0.8;
  const fontSize = fitFontSize(ctx, label, h * 0.4, maxTextWidth);
  ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (method === "embroidered") {
    // Render text to an offscreen layer so the stitch-line texture can be
    // composited with "source-atop" onto text pixels only.
    const textLayer = makeCanvas(w, h);
    const tlCtx = textLayer.getContext("2d")!;
    tlCtx.font = ctx.font;
    tlCtx.textAlign = "center";
    tlCtx.textBaseline = "middle";
    tlCtx.fillStyle = scheme.text;
    tlCtx.fillText(label, w / 2, h / 2);

    const pattern = buildStitchTilePattern(tlCtx, 0.5);
    tlCtx.save();
    tlCtx.globalCompositeOperation = "source-atop";
    tlCtx.fillStyle = pattern;
    tlCtx.fillRect(0, 0, w, h);
    tlCtx.restore();

    ctx.drawImage(textLayer, 0, 0);
  } else {
    ctx.fillStyle = scheme.text;
    ctx.fillText(label, w / 2, h / 2);
  }

  return canvas;
}
