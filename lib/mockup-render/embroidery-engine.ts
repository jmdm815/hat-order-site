// ---------------------------------------------------------------------------
// Custom Hat Mockup Generator — embroidery rendering engine (phase 2)
// ---------------------------------------------------------------------------

import { EmbroiderySettings } from "@/lib/mockup-types";
import { makeCanvas, meshWarpPerspective } from "./canvas-utils";

type Rect = { x: number; y: number; width: number; height: number };

function drawContain(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number
): void {
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const dw = imgW * scale;
  const dh = imgH * scale;
  ctx.drawImage(img, (boxW - dw) / 2, (boxH - dh) / 2, dw, dh);
}

// Small tileable diagonal stitch-line pattern: alternating light/dark 2px
// lines at 45deg, spaced ~3-4px apart.
function buildStitchPattern(ctx: CanvasRenderingContext2D, opacity: number): CanvasPattern {
  const tile = makeCanvas(8, 8);
  const tctx = tile.getContext("2d")!;
  tctx.fillStyle = "rgba(0,0,0,0)";
  tctx.fillRect(0, 0, 8, 8);
  tctx.strokeStyle = `rgba(255,255,255,${(opacity * 0.6).toFixed(3)})`;
  tctx.lineWidth = 2;
  tctx.beginPath();
  tctx.moveTo(-2, 10);
  tctx.lineTo(10, -2);
  tctx.stroke();
  tctx.strokeStyle = `rgba(0,0,0,${(opacity * 0.5).toFixed(3)})`;
  tctx.lineWidth = 1;
  tctx.beginPath();
  tctx.moveTo(-2, 6);
  tctx.lineTo(6, -2);
  tctx.moveTo(2, 10);
  tctx.lineTo(10, 2);
  tctx.stroke();
  return ctx.createPattern(tile, "repeat")!;
}

export function renderEmbroidery(
  destCtx: CanvasRenderingContext2D,
  artwork: HTMLImageElement,
  targetRect: Rect,
  settings: EmbroiderySettings
): void {
  const w = Math.round(targetRect.width);
  const h = Math.round(targetRect.height);

  // Step 1: base artwork, contained within the target box.
  const base = makeCanvas(w, h);
  const baseCtx = base.getContext("2d")!;
  drawContain(baseCtx, artwork, artwork.width, artwork.height, w, h);

  // Step 2: thread-texture (embossed) pass — offset-tinted duplicates
  // composited with "overlay" to fake dimensional raised thread.
  const stitchDepth = Math.max(0, Math.min(100, settings.stitchDepth)) / 100;
  const threadIntensity = Math.max(0, Math.min(100, settings.threadTextureIntensity)) / 100;
  const shadowIntensity = Math.max(0, Math.min(100, settings.shadowIntensity)) / 100;
  const offset = 0.5 + stitchDepth * 1.5;

  const textured = makeCanvas(w, h);
  const tCtx = textured.getContext("2d")!;
  tCtx.drawImage(base, 0, 0);

  tCtx.globalCompositeOperation = "overlay";
  tCtx.globalAlpha = Math.min(0.35, 0.15 + threadIntensity * 0.2);
  tCtx.filter = "brightness(1.8)";
  tCtx.drawImage(base, -offset, -offset);
  tCtx.filter = "none";

  tCtx.globalAlpha = Math.min(0.35, 0.15 + shadowIntensity * 0.2);
  tCtx.filter = "brightness(0.3)";
  tCtx.drawImage(base, offset, offset);
  tCtx.filter = "none";
  tCtx.globalAlpha = 1;
  tCtx.globalCompositeOperation = "source-over";

  // Clip embossing to the original artwork's alpha shape so it never bleeds
  // outside the logo (the "overlay" passes above are full-canvas and can
  // leak into transparent padding otherwise).
  tCtx.globalCompositeOperation = "destination-in";
  tCtx.drawImage(base, 0, 0);
  tCtx.globalCompositeOperation = "source-over";

  // Step 3: directional stitch-line pattern, composited with "source-atop"
  // so it only affects non-transparent artwork pixels.
  const stitchOpacity = threadIntensity * 0.5;
  if (stitchOpacity > 0.01) {
    const pattern = buildStitchPattern(tCtx, stitchOpacity);
    tCtx.save();
    tCtx.globalCompositeOperation = "source-atop";
    tCtx.fillStyle = pattern;
    tCtx.fillRect(0, 0, w, h);
    tCtx.restore();
  }

  // Step 4: warp for curvature, then composite onto destination.
  const tiltDeg = (settings.perspectiveAmount / 100) * 8;
  const bulgePct = (settings.perspectiveAmount / 100) * 100;

  destCtx.save();
  destCtx.shadowColor = "rgba(0,0,0,0.25)";
  destCtx.shadowBlur = Math.max(2, h * 0.04);
  destCtx.shadowOffsetY = Math.max(1, h * 0.015);
  meshWarpPerspective(textured, destCtx, targetRect.x, targetRect.y, w, h, tiltDeg, bulgePct);
  destCtx.restore();
}
