// ---------------------------------------------------------------------------
// Custom Hat Mockup Generator — UV-printed patch rendering engine (phase 2)
// ---------------------------------------------------------------------------

import { PatchMaterial, PatchShape, PatchSize, UvSettings } from "@/lib/mockup-types";
import { meshWarpPerspective } from "./canvas-utils";
import { buildPatchCanvas } from "./patch-builder";

type Rect = { x: number; y: number; width: number; height: number };

export function renderUvPatch(
  destCtx: CanvasRenderingContext2D,
  artwork: HTMLImageElement,
  targetRect: Rect,
  material: PatchMaterial,
  shape: PatchShape,
  size: PatchSize,
  methodSettings: UvSettings
): void {
  const aspect = size.widthIn / size.heightIn;
  let widthPx = targetRect.width;
  let heightPx = widthPx / aspect;
  if (heightPx > targetRect.height) {
    heightPx = targetRect.height;
    widthPx = heightPx * aspect;
  }

  const patch = buildPatchCanvas({
    widthPx,
    heightPx,
    shape,
    material,
    artwork,
    mode: "uv",
    methodSettings,
  });

  const drawX = targetRect.x + (targetRect.width - widthPx) / 2;
  const drawY = targetRect.y + (targetRect.height - heightPx) / 2;

  const tiltDeg = (methodSettings.perspectiveAmount / 100) * 8;
  const bulgePct = (methodSettings.perspectiveAmount / 100) * 100;

  destCtx.save();
  destCtx.shadowColor = "rgba(0,0,0,0.3)";
  destCtx.shadowBlur = Math.max(2, heightPx * 0.05);
  destCtx.shadowOffsetY = Math.max(1, heightPx * 0.025);
  meshWarpPerspective(patch, destCtx, drawX, drawY, widthPx, heightPx, tiltDeg, bulgePct);
  destCtx.restore();
}
