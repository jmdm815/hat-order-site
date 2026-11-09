import { put } from "@vercel/blob";
import sharp from "sharp";

export const MAX_SEWOUT_UPLOAD_BYTES = 15 * 1024 * 1024;

// Phone photo -> upright, white-backed JPEG no larger than 1800px, stored in
// the private Blob store. Returns the blob URL (serve via itemPhotoUrl()).
export async function storeSewoutPhoto(file: File, folder: string): Promise<string> {
  const input = Buffer.from(await file.arrayBuffer());
  const processed = await sharp(input)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(1800, 1800, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
  const blob = await put(`sewout-photos/${folder}/${Date.now()}.jpg`, processed, {
    access: "private",
    addRandomSuffix: true,
    contentType: "image/jpeg",
  });
  return blob.url;
}

// Square card image (already cropped in the browser): normalized to an
// 800px square JPEG.
export async function storeSewoutCover(file: File, folder: string): Promise<string> {
  const input = Buffer.from(await file.arrayBuffer());
  const processed = await sharp(input)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(800, 800, { fit: "cover" })
    .jpeg({ quality: 88 })
    .toBuffer();
  const blob = await put(`sewout-photos/${folder}/cover-${Date.now()}.jpg`, processed, {
    access: "private",
    addRandomSuffix: true,
    contentType: "image/jpeg",
  });
  return blob.url;
}
