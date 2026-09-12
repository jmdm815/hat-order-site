// ---------------------------------------------------------------------------
// Custom Hat Mockup Generator — patch construction shared by the engraving
// and UV rendering engines (phase 2)
// ---------------------------------------------------------------------------

import { EngravingSettings, PatchMaterial, PatchShape, UvSettings } from "@/lib/mockup-types";
import { buildShapePath2D, generateLeatheretteTexture, makeCanvas } from "./canvas-utils";

export type BuildPatchCanvasOpts = {
  widthPx: number;
  heightPx: number;
  shape: PatchShape;
  material: PatchMaterial;
  artwork: HTMLImageElement;
  mode: "engraved" | "uv";
  methodSettings: EngravingSettings | UvSettings;
};

function drawContain(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  imgW: number,
  imgH: number,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number
): void {
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const dw = imgW * scale;
  const dh = imgH * scale;
  ctx.drawImage(img, boxX + (boxW - dw) / 2, boxY + (boxH - dh) / 2, dw, dh);
}

// Converts the artwork into a monochrome engraving mask: every pixel above
// the alpha threshold becomes fully-opaque engravingColorHex, everything
// else fully transparent. Original hue/luminance is intentionally ignored —
// a real laser engraving reveals a single lower-layer color, it doesn't
// preserve grayscale shading.
function buildEngravingMask(
  artwork: HTMLImageElement,
  w: number,
  h: number,
  colorHex: string
): HTMLCanvasElement {
  const src = makeCanvas(w, h);
  const sctx = src.getContext("2d")!;
  drawContain(sctx, artwork, artwork.width, artwork.height, 0, 0, w, h);

  const out = makeCanvas(w, h);
  const octx = out.getContext("2d")!;

  try {
    const data = sctx.getImageData(0, 0, w, h);
    const pixels = data.data;
    const [r, g, b] = hexToRgb(colorHex);
    const threshold = 40;
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3];
      if (alpha > threshold) {
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = 255;
      } else {
        pixels[i + 3] = 0;
      }
    }
    octx.putImageData(data, 0, 0);
  } catch {
    // Same-origin artwork should never hit this (only third-party hat
    // photos can taint a canvas), but fall back to drawing it as-is rather
    // than throwing.
    octx.drawImage(src, 0, 0);
  }

  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full || "1a1a1a", 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.round(v * (1 - amount)));
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(f(r))}${h(f(g))}${h(f(b))}`;
}

export function buildPatchCanvas(opts: BuildPatchCanvasOpts): HTMLCanvasElement {
  const { widthPx, heightPx, shape, material, artwork, mode, methodSettings } = opts;
  const w = Math.round(widthPx);
  const h = Math.round(heightPx);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const path = buildShapePath2D(shape, w, h);

  ctx.save();
  ctx.clip(path);

  // 2. Background fill.
  if (mode === "engraved") {
    const texture = generateLeatheretteTexture(w, h, material.textureStrength, material.surfaceColorHex);
    ctx.drawImage(texture, 0, 0);
  } else {
    ctx.fillStyle = material.surfaceColorHex;
    ctx.fillRect(0, 0, w, h);
    if (material.textureStrength > 0) {
      const texture = generateLeatheretteTexture(w, h, material.textureStrength * 0.3, material.surfaceColorHex);
      ctx.globalAlpha = 0.6;
      ctx.drawImage(texture, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  // 3. Artwork placement, inset by an 8% safe-area margin.
  const marginX = w * 0.08;
  const marginY = h * 0.08;
  const safeX = marginX;
  const safeY = marginY;
  const safeW = w - marginX * 2;
  const safeH = h - marginY * 2;

  if (mode === "engraved") {
    const engravingSettings = methodSettings as EngravingSettings;
    const mask = buildEngravingMask(artwork, safeW, safeH, material.engravingColorHex);

    // Faint edge-darkening ring (simulated laser-cut bevel): draw the mask
    // several times at small radial offsets in a darker shade, underneath
    // the main mask.
    const edgeBurn = Math.max(0, Math.min(100, engravingSettings.edgeBurn)) / 100;
    if (edgeBurn > 0.01) {
      const bevelColor = darken(material.engravingColorHex, 0.35);
      const steps = 6;
      const dist = 1 + edgeBurn * 1.5;
      ctx.save();
      ctx.globalAlpha = 0.12 + edgeBurn * 0.25;
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const ox = Math.cos(angle) * dist;
        const oy = Math.sin(angle) * dist;
        const tinted = makeCanvas(safeW, safeH);
        const tctx = tinted.getContext("2d")!;
        tctx.drawImage(mask, 0, 0);
        tctx.globalCompositeOperation = "source-in";
        tctx.fillStyle = bevelColor;
        tctx.fillRect(0, 0, safeW, safeH);
        ctx.drawImage(tinted, safeX + ox, safeY + oy);
      }
      ctx.restore();
    }

    ctx.drawImage(mask, safeX, safeY);
  } else {
    const uvSettings = methodSettings as UvSettings;
    if (uvSettings.printDepth > 0) {
      ctx.save();
      const depth = Math.max(0, Math.min(100, uvSettings.printDepth)) / 100;
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 2 + depth * 4;
      ctx.shadowOffsetY = 1 + depth * 2;
      drawContain(ctx, artwork, artwork.width, artwork.height, safeX, safeY, safeW, safeH);
      ctx.restore();
    } else {
      drawContain(ctx, artwork, artwork.width, artwork.height, safeX, safeY, safeW, safeH);
    }

    // 4. UV-only glossy sheen highlight.
    if (uvSettings.textureVisibility > 0) {
      const visibility = Math.max(0, Math.min(100, uvSettings.textureVisibility)) / 100;
      const angle = (20 * Math.PI) / 180;
      const x0 = 0;
      const y0 = 0;
      const x1 = w * Math.cos(angle);
      const y1 = h * Math.sin(angle);
      const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      gradient.addColorStop(0.5, `rgba(255,255,255,${(visibility * 0.4).toFixed(3)})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  ctx.restore(); // undo clip

  // 5. Patch border.
  const borderColor = material.edgeColorHex ?? "#1a1a1a";
  const borderWidth = Math.max(1, Math.min(w, h) * 0.025);
  ctx.save();
  ctx.lineWidth = borderWidth;
  ctx.strokeStyle = borderColor;
  ctx.stroke(path);
  ctx.restore();

  return canvas;
}
