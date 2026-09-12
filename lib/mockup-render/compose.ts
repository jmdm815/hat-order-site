// ---------------------------------------------------------------------------
// Custom Hat Mockup Generator — top-level render orchestrator (phase 2)
// ---------------------------------------------------------------------------

import {
  DecorationMethodSettings,
  MockupDecorationMethod,
  MockupHatCalibration,
  MockupSettings,
  PatchMaterial,
  PatchShape,
  PatchSize,
} from "@/lib/mockup-types";
import { generateBanner } from "./banner-generator";
import { makeCanvas } from "./canvas-utils";
import { renderEmbroidery } from "./embroidery-engine";
import { renderEngravedPatch } from "./engraving-engine";
import { renderUvPatch } from "./uv-engine";

export type ComposeMockupInput = {
  hatImage: HTMLImageElement;
  artworkImage: HTMLImageElement;
  method: MockupDecorationMethod;
  material?: PatchMaterial; // required for engraved/uv
  shape?: PatchShape; // required for engraved/uv
  size?: PatchSize; // required for engraved/uv
  calibration: MockupHatCalibration;
  methodSettings: DecorationMethodSettings;
  mockupSettings: MockupSettings;
};

export async function composeMockup(input: ComposeMockupInput): Promise<HTMLCanvasElement> {
  const { hatImage, artworkImage, method, material, shape, size, calibration, methodSettings, mockupSettings } = input;

  const multiplier = mockupSettings.exportResolutionMultiplier;
  const logicalW = mockupSettings.exportWidth;
  const logicalH = mockupSettings.exportHeight;

  const canvas = makeCanvas(logicalW * multiplier, logicalH * multiplier);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(multiplier, multiplier);

  // Background.
  ctx.fillStyle = mockupSettings.backgroundColor;
  ctx.fillRect(0, 0, logicalW, logicalH);

  // Hat image, centered in the top area, sized per hatScalePct/hatOffsetYPct.
  const hatBoxW = logicalW * (mockupSettings.hatScalePct / 100);
  const hatScale = hatBoxW / hatImage.width;
  const hatDrawW = hatImage.width * hatScale;
  const hatDrawH = hatImage.height * hatScale;
  const hatX = (logicalW - hatDrawW) / 2;
  // Reserve room below the hat for the banner; center the hat in the
  // remaining top area, then nudge by hatOffsetYPct.
  const bannerAreaH = mockupSettings.bannerHeightPx + mockupSettings.bannerSpacingPx;
  const hatAreaH = logicalH - bannerAreaH;
  const hatY =
    (hatAreaH - hatDrawH) / 2 + (mockupSettings.hatOffsetYPct / 100) * hatAreaH;

  ctx.drawImage(hatImage, hatX, hatY, hatDrawW, hatDrawH);

  // Decoration target rect, computed from calibration (percent of the hat
  // image's drawn width/height) within the hat's drawn bounds.
  if (method === "embroidered") {
    const maxWPct = calibration.maxWidthIn / calibration.refWidthIn;
    const maxHPct = maxWPct * (methodSettings.embroidery.defaultMaxHeightIn / methodSettings.embroidery.defaultMaxWidthIn);
    const targetWidth = hatDrawW * maxWPct;
    const targetHeight = hatDrawH * maxHPct;
    const centerX = hatX + hatDrawW * (calibration.centerXPct / 100);
    const centerY = hatY + hatDrawH * (calibration.centerYPct / 100);
    const targetRect = {
      x: centerX - targetWidth / 2,
      y: centerY - targetHeight / 2,
      width: targetWidth,
      height: targetHeight,
    };
    renderEmbroidery(ctx, artworkImage, targetRect, methodSettings.embroidery);
  } else {
    if (!material || !shape || !size) {
      throw new Error(`composeMockup: material, shape, and size are required for method "${method}"`);
    }
    const maxWPct = calibration.maxWidthIn / calibration.refWidthIn;
    const maxHPct = calibration.maxHeightIn / calibration.refWidthIn;
    const targetWidth = hatDrawW * maxWPct;
    const targetHeight = hatDrawH * maxHPct;
    const centerX = hatX + hatDrawW * (calibration.centerXPct / 100);
    const centerY = hatY + hatDrawH * (calibration.centerYPct / 100);
    const targetRect = {
      x: centerX - targetWidth / 2,
      y: centerY - targetHeight / 2,
      width: targetWidth,
      height: targetHeight,
    };
    if (method === "engraved") {
      renderEngravedPatch(ctx, artworkImage, targetRect, material, shape, size, methodSettings.engraving);
    } else {
      renderUvPatch(ctx, artworkImage, targetRect, material, shape, size, methodSettings.uv);
    }
  }

  // Banner, centered below the hat.
  const bannerW = logicalW * (mockupSettings.bannerWidthPct / 100);
  const bannerH = mockupSettings.bannerHeightPx;
  const bannerCanvas = generateBanner({
    widthPx: bannerW,
    heightPx: bannerH,
    method,
    artwork: artworkImage,
    material,
  });
  const bannerX = (logicalW - bannerW) / 2;
  const bannerY = hatY + hatDrawH + mockupSettings.bannerSpacingPx;
  ctx.drawImage(bannerCanvas, bannerX, bannerY);

  return canvas;
}
