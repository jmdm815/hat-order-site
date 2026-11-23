import sharp, { type OverlayOptions } from "sharp";
import { put } from "@vercel/blob";
import { DPI, SHEET_WIDTH_IN, type GangSheetRecord } from "./gang-sheet";
import { fetchPrivateBlob, saveSheet } from "./gang-sheet-store";

sharp.cache(false);

/**
 * Renders the 300 dpi transparent print PNG (7200 px wide) plus a small
 * preview, uploads both to Blob and marks the record ready.
 * Upload mode: the customer's file IS the print file; we only make a preview.
 */
export async function renderSheet(rec: GangSheetRecord): Promise<GangSheetRecord> {
  try {
    let png: Buffer;
    if (rec.mode === "upload" && rec.uploadedSheet) {
      const res = await fetchPrivateBlob(rec.uploadedSheet.url);
      if (!res.ok) throw new Error(`Couldn't read the uploaded sheet (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      // Normalise to PNG at 300 dpi metadata, 7200 px wide (resample only if needed).
      const meta = await sharp(buf, { limitInputPixels: false }).metadata();
      let img = sharp(buf, { limitInputPixels: false }).ensureAlpha();
      if (meta.width !== SHEET_WIDTH_IN * DPI) img = img.resize({ width: SHEET_WIDTH_IN * DPI, kernel: "lanczos3" });
      png = await img.png({ compressionLevel: 6 }).withMetadata({ density: DPI }).toBuffer();
    } else {
      const W = SHEET_WIDTH_IN * DPI;
      const H = Math.round(rec.lengthIn * DPI);
      const assets = new Map(rec.assets.map((a) => [a.id, a]));
      const sources = new Map<string, Buffer>();
      const pieces = new Map<string, Buffer>(); // asset+size+rotation -> rendered piece (reused across copies)
      const placed: { buf: Buffer; left: number; top: number; h: number }[] = [];
      for (const it of rec.items) {
        const a = assets.get(it.assetId);
        if (!a) continue;
        if (!sources.has(a.id)) {
          const res = await fetchPrivateBlob(a.url);
          if (!res.ok) throw new Error(`Couldn't read “${a.name}” (${res.status})`);
          sources.set(a.id, Buffer.from(await res.arrayBuffer()));
        }
        const src = sources.get(a.id)!;
        const boxW = Math.max(1, Math.round(it.w * DPI));
        const boxH = Math.max(1, Math.round(it.h * DPI));
        const sideways = it.rot === 90 || it.rot === 270;
        const artW = sideways ? boxH : boxW;
        const artH = sideways ? boxW : boxH;
        const key = `${a.id}:${artW}x${artH}:${it.rot}`;
        if (!pieces.has(key)) {
          const opts = a.isVector ? { density: Math.min(2400, Math.max(72, (72 * artW) / Math.max(1, a.pxW))), limitInputPixels: false } : { limitInputPixels: false };
          let piece = sharp(src, opts).ensureAlpha().resize(artW, artH, { fit: "fill", kernel: "lanczos3" });
          if (it.rot) piece = sharp(await piece.png().toBuffer(), { limitInputPixels: false }).rotate(it.rot);
          pieces.set(key, await piece.png().toBuffer());
        }
        placed.push({ buf: pieces.get(key)!, left: Math.round(it.x * DPI), top: Math.round(it.y * DPI), h: boxH });
      }
      // Composite in 12" bands (pieces crossing a band edge are clipped by
      // libvips), then join — keeps memory ~0.5 GB even for a 192" sheet.
      const BAND = 12 * DPI;
      const bands: Buffer[] = [];
      for (let y0 = 0; y0 < H; y0 += BAND) {
        const bh = Math.min(BAND, H - y0);
        const layers: OverlayOptions[] = placed
          .filter((p) => p.top < y0 + bh && p.top + p.h > y0)
          .map((p) => ({ input: p.buf, left: p.left, top: p.top - y0 }));
        bands.push(
          await sharp({ create: { width: W, height: bh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite(layers)
            .png({ compressionLevel: 1 })
            .toBuffer(),
        );
      }
      png = await sharp(bands, { join: { across: 1 }, limitInputPixels: false })
        .png({ compressionLevel: 6 })
        .withMetadata({ density: DPI })
        .toBuffer();
    }
    const preview = await sharp(png, { limitInputPixels: false }).resize({ width: 720 }).png().toBuffer();
    const base = `gang-sheets/renders/${rec.id}`;
    const [full, prev] = await Promise.all([
      put(`${base}/${rec.number}-24x${rec.lengthIn}in-300dpi.png`, png, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "image/png" }),
      put(`${base}/preview.png`, preview, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "image/png" }),
    ]);
    const done: GangSheetRecord = { ...rec, status: "ready", pngUrl: full.url, previewUrl: prev.url, renderedAt: new Date().toISOString(), error: undefined };
    await saveSheet(done);
    return done;
  } catch (err) {
    console.error("gang-sheet render failed", rec.id, err);
    const failed: GangSheetRecord = { ...rec, status: "failed", error: err instanceof Error ? err.message : String(err) };
    await saveSheet(failed);
    return failed;
  }
}
