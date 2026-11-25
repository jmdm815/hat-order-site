import sharp from "sharp";
import { analyzeImg, applyEditsImg, type EditOp, type Img, type PaletteColor } from "./logo-edit-core";

// Node wrapper (sharp decode/encode) around the pure edit code in
// lib/logo-edit-core.ts, which says what the edits do.
export * from "./logo-edit-core";

const MAX_SIDE = 3000; // mockups never need more

async function load(buf: Buffer, maxSide = MAX_SIDE): Promise<Img> {
  const { data, info } = await sharp(buf)
    .rotate()
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { d: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
}

const toPng = (im: Img) =>
  sharp(Buffer.from(im.d.buffer, im.d.byteOffset, im.d.length), { raw: { width: im.w, height: im.h, channels: 4 } })
    .png()
    .toBuffer();

export async function analyzeLogo(buf: Buffer): Promise<{ palette: PaletteColor[]; w: number; h: number; hasHoles: boolean }> {
  return analyzeImg(await load(buf, 600));
}

/** Apply edits in order; returns a transparent PNG (max 3000 px). */
export async function applyEdits(logo: Buffer, ops: EditOp[]): Promise<Buffer> {
  return toPng(applyEditsImg(await load(logo), ops));
}
